import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { sharedStore } from '../lib/rateLimitStore.js'
import { prisma } from '../lib/prisma.js'
import { sendMail } from '../lib/mailer.js'
import { passwordReset, passwordChanged } from '../lib/emails.js'

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

authRouter.get('/me', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'not authenticated' })
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, email: true, displayName: true, isSuperAdmin: true },
  })
  res.json(user)
})
