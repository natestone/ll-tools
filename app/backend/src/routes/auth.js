import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { sharedStore } from '../lib/rateLimitStore.js'
import { requireAuth } from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'
import { sendMail } from '../lib/mailer.js'
import { passwordReset, passwordChanged, emailChangeVerify, emailChangeNotice } from '../lib/emails.js'

export const authRouter = Router()

const RESET_TTL_MIN = 60
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

// Without a limit these endpoints are a free mail cannon aimed at any address
// someone types, and a brute-force surface for reset tokens.
const forgotLimiter = rateLimit({
  ...sharedStore('auth:forgot'),
  windowMs: 15 * 60 * 1000, limit: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again in a few minutes.' },
})
const emailChangeLimiter = rateLimit({
  ...sharedStore('auth:emailchange'),
  windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
})
const resetLimiter = rateLimit({
  ...sharedStore('auth:reset'),
  windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
})

authRouter.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body || {}
  if (!email || !password || !displayName) return res.status(400).json({ error: 'email, password, displayName required' })
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existing) return res.status(409).json({ error: 'email already registered' })
  const user = await prisma.user.create({
    data: { email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10), displayName },
  })
  req.session.userId = user.id
  res.json({ id: user.id, email: user.email, displayName: user.displayName })
})

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  const user = await prisma.user.findUnique({ where: { email: (email || '').toLowerCase() } })
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash)))
    return res.status(401).json({ error: 'invalid credentials' })
  req.session.userId = user.id
  res.json({ id: user.id, email: user.email, displayName: user.displayName })
})

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

/* ---- forgot / reset password -------------------------------------------- */

// express-session owns the `sessions` table; we only read it to sign a user out
// everywhere. The Session model is declared in schema.prisma purely so `db push`
// stops dropping the table.
async function revokeSessionsFor(userId) {
  try {
    const rows = await prisma.session.findMany({ select: { session_id: true, data: true } })
    const doomed = rows
      .filter((r) => { try { return JSON.parse(r.data || '{}').userId === userId } catch { return false } })
      .map((r) => r.session_id)
    if (doomed.length) await prisma.session.deleteMany({ where: { session_id: { in: doomed } } })
  } catch (e) {
    // Never fail the reset over this — the password is already changed.
    console.error('[auth] could not revoke sessions:', e.message)
  }
}

// ALWAYS returns the same 200, whether or not the address is registered.
// Saying "no such user" would turn this into an account-enumeration oracle —
// anyone could test which of a league's emails have accounts.
authRouter.post('/forgot', forgotLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const ok = { ok: true, message: 'If that address has an account, a reset link is on its way.' }
  if (!email) return res.json(ok)

  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    // Invalidate any outstanding tokens so only the newest link works.
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() },
    })
    const token = crypto.randomBytes(32).toString('hex')
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000),
      },
    })
    const mail = await sendMail({
      to: user.email,
      ...passwordReset({ displayName: user.displayName, token, expiresMinutes: RESET_TTL_MIN }),
    })
    if (!mail.ok) console.error(`[auth] reset email to ${user.email} failed: ${mail.error}`)
  }
  res.json(ok)
})

authRouter.post('/reset', resetLimiter, async (req, res) => {
  const { token, password } = req.body || {}
  if (!token || !password) return res.status(400).json({ error: 'token and password required' })
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' })

  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: sha256(String(token)) }, include: { user: true },
  })
  // One message for every failure mode — expired, used and forged are
  // indistinguishable to the caller on purpose.
  if (!row || row.usedAt || row.expiresAt < new Date())
    return res.status(400).json({ error: 'That reset link is invalid or has expired. Request a new one.' })

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await bcrypt.hash(String(password), 10) },
    }),
    prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ])

  // Drop every session for this user: a reset is the remedy for a compromised
  // account, so any session an attacker holds must die with it.
  // Parsed rather than matched with LIKE '%"userId":5%', which would also match
  // userId 50 and sign out the wrong people.
  await revokeSessionsFor(row.userId)

  const mail = await sendMail({ to: row.user.email, ...passwordChanged({ displayName: row.user.displayName }) })
  if (!mail.ok) console.error(`[auth] password-changed notice to ${row.user.email} failed: ${mail.error}`)

  res.json({ ok: true })
})

/* ============================================================================
   Changing the sign-in address.

   Two messages go out, and the second is the one that matters. The token goes
   only to the NEW address, so following the link proves control of that
   mailbox. The OLD address gets a notice with no token at all, which is what
   stops a stolen session being used to quietly take an account: the thief can
   start a change, but cannot prevent the owner hearing about it.
   ========================================================================== */

const EMAIL_CHANGE_TTL_MIN = 60

authRouter.post('/email-change', requireAuth, emailChangeLimiter, async (req, res) => {
  const newEmail = String(req.body?.email || '').trim().toLowerCase()
  const me = await prisma.user.findUnique({ where: { id: req.session.userId } })
  if (!me) return res.status(401).json({ error: 'not authenticated' })

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail))
    return res.status(400).json({ error: "That email address doesn't look right." })
  if (newEmail === me.email)
    return res.status(400).json({ error: 'That is already your email address.' })

  // Re-authenticate before changing a credential: a session left open on a
  // shared laptop should not be enough to walk off with the account.
  const password = String(req.body?.password || '')
  if (!password || !(await bcrypt.compare(password, me.passwordHash)))
    return res.status(400).json({ error: 'That password is not correct.' })

  // Say the same thing whether or not the address is taken, so this is not a
  // way to discover who has an account.
  const taken = await prisma.user.findUnique({ where: { email: newEmail } })
  const ok = { ok: true, message: `If that address can be used, a confirmation link is on its way to ${newEmail}.` }
  if (taken) return res.json(ok)

  // Only the newest link should work.
  await prisma.emailChange.updateMany({
    where: { userId: me.id, usedAt: null }, data: { usedAt: new Date() },
  })
  const token = crypto.randomBytes(32).toString('hex')
  await prisma.emailChange.create({
    data: {
      userId: me.id, newEmail, tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MIN * 60_000),
    },
  })

  const sent = await sendMail({
    to: newEmail,
    ...emailChangeVerify({ displayName: me.displayName, newEmail, token, expiresMinutes: EMAIL_CHANGE_TTL_MIN }),
  })
  if (!sent.ok) console.error(`[auth] email-change verify to ${newEmail} failed: ${sent.error || sent.reason}`)

  const notice = await sendMail({ to: me.email, ...emailChangeNotice({ displayName: me.displayName, newEmail }) })
  if (!notice.ok) console.error(`[auth] email-change notice to ${me.email} failed: ${notice.error || notice.reason}`)

  res.json(ok)
})

/* No session required: the link is opened from the new mailbox, often on a
   phone that is not signed in. The token is the proof. */
authRouter.post('/email-change/confirm', emailChangeLimiter, async (req, res) => {
  const token = String(req.body?.token || '')
  if (!token) return res.status(400).json({ error: 'That link is missing its code.' })

  const row = await prisma.emailChange.findUnique({
    where: { tokenHash: sha256(token) }, include: { user: true },
  })
  // Expired, already used and forged are deliberately indistinguishable.
  if (!row || row.usedAt || row.expiresAt < new Date())
    return res.status(400).json({ error: 'That link is invalid or has expired. Request a new one.' })

  // Someone may have claimed the address in the meantime.
  const clash = await prisma.user.findUnique({ where: { email: row.newEmail } })
  if (clash && clash.id !== row.userId) {
    await prisma.emailChange.update({ where: { id: row.id }, data: { usedAt: new Date() } })
    return res.status(400).json({ error: 'That address is no longer available.' })
  }

  const oldEmail = row.user.email
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { email: row.newEmail } }),
    prisma.emailChange.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ])

  // Tell the old address it is done — the last chance for the real owner to
  // notice if this was not them.
  const notice = await sendMail({
    to: oldEmail,
    ...emailChangeNotice({ displayName: row.user.displayName, newEmail: row.newEmail, done: true }),
  })
  if (!notice.ok) console.error(`[auth] email-changed notice to ${oldEmail} failed: ${notice.error || notice.reason}`)

  res.json({ ok: true, email: row.newEmail })
})

authRouter.get('/me', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'not authenticated' })
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, email: true, displayName: true, isSuperAdmin: true },
  })
  res.json(user)
})
