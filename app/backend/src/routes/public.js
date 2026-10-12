import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { sharedStore } from '../lib/rateLimitStore.js'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { sendMail } from '../lib/mailer.js'
import { allStarVoteCode, allStarSignupConfirmation } from '../lib/emails.js'

/* ============================================================================
   Public All-Star endpoints. No session: a parent filling in the signup form is
   not a league member and never will be.

   Access is by unguessable slug, so every route here is rate limited and
   returns the same 404 for a bad token as for a closed season — a probe should
   not be able to tell which leagues exist.
   ========================================================================== */

export const publicRouter = Router()

const limiter = rateLimit({
  ...sharedStore('public'),
  windowMs: 15 * 60 * 1000, limit: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})
publicRouter.use(limiter)

const dateOnly = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : null)
const MAX_PLAYERS_PER_FORM = 10
const notFound = (res) => res.status(404).json({ error: 'This signup link is not valid.' })

/** Everything the signup page needs: league name, consent text, levels. */
publicRouter.get('/allstar/:slug', async (req, res) => {
  const season = await prisma.allStarSeason.findUnique({
    where: { publicSlug: req.params.slug },
    include: { league: { select: { name: true } },
      levels: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  })
  if (!season) return notFound(res)
  res.json({
    leagueName: season.league.name,
    year: season.year,
    signupOpen: season.signupOpen,
    consentMd: season.consentMd,
    // bounds are what the form filters on; ids are needed to submit
    levels: season.levels.map((l) => ({ id: l.id, name: l.name, bornFrom: l.bornFrom, bornTo: l.bornTo })),
  })
})

/** A parent signing one or more children up, each for one or more levels. */
publicRouter.post('/allstar/:slug/signup', async (req, res) => {
  const season = await prisma.allStarSeason.findUnique({
    where: { publicSlug: req.params.slug },
    include: { levels: true, league: { select: { name: true } } },
  })
  if (!season) return notFound(res)
  if (!season.signupOpen) return res.status(400).json({ error: 'Signups for this season are closed.' })

  const parentName = String(req.body?.parentName || '').trim()
  const parentEmail = String(req.body?.parentEmail || '').trim().toLowerCase()
  const parentPhone = String(req.body?.parentPhone || '').trim() || null

  if (!parentName) return res.status(400).json({ error: 'Type your name to sign the agreement.' })
  // Required now: it is the league's only reliable way back to the family, and
  // it is where the signed-consent receipt goes.
  if (!parentEmail) return res.status(400).json({ error: 'Your email address is required.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(parentEmail))
    return res.status(400).json({ error: "That email address doesn't look right." })

  /* One form can carry a whole family. A payload from the old single-player
     form is simply a list of one, so an open tab mid-deploy still works. */
  const raw = Array.isArray(req.body?.players) && req.body.players.length
    ? req.body.players
    : [{ playerName: req.body?.playerName, playerDob: req.body?.playerDob, levelIds: req.body?.levelIds }]
  if (raw.length > MAX_PLAYERS_PER_FORM)
    return res.status(400).json({ error: `One form can hold at most ${MAX_PLAYERS_PER_FORM} players.` })

  const players = []
  for (const [i, p] of raw.entries()) {
    // With several children on screen, "the player's name is required" is not
    // enough to say which row is wrong.
    const which = raw.length > 1 ? ` for player ${i + 1}` : ''
    const playerName = String(p?.playerName || '').trim()
    const playerDob = dateOnly(p?.playerDob)
    const levelIds = Array.isArray(p?.levelIds) ? [...new Set(p.levelIds.map(Number))] : []

    if (!playerName) return res.status(400).json({ error: `The player's name is required${which}.` })
    if (!playerDob || Number.isNaN(playerDob.getTime()))
      return res.status(400).json({ error: `The player's date of birth is required${which}.` })
    if (!levelIds.length) return res.status(400).json({ error: `Choose at least one level${which}.` })

    // Eligibility is re-checked here, never trusted from the browser: the form
    // hides ineligible levels, but the request can be made without the form.
    const chosen = season.levels.filter((l) => levelIds.includes(l.id))
    if (chosen.length !== levelIds.length) return res.status(400).json({ error: 'Unknown level selected.' })
    const ineligible = chosen.filter((l) => playerDob < l.bornFrom || playerDob > l.bornTo)
    if (ineligible.length)
      return res.status(400).json({
        error: `${playerName} is not eligible for ${ineligible.map((l) => l.name).join(', ')}.`,
      })

    players.push({ playerName, playerDob, chosen })
  }

  // The same child entered twice on one form is a slip — two siblings cannot
  // share a name and a birthday.
  const seen = new Set()
  for (const p of players) {
    const key = `${p.playerName.toLowerCase()}|${p.playerDob.toISOString().slice(0, 10)}`
    if (seen.has(key)) return res.status(400).json({ error: `${p.playerName} is on this form twice.` })
    seen.add(key)
  }

  const signedIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .toString().split(',')[0].trim() || null

  // All or nothing. A family half-registered because row three failed is worse
  // than a submission that cleanly failed and can be retried.
  const created = await prisma.$transaction(players.map((p) => prisma.allStarSignup.create({
    data: {
      seasonId: season.id, playerName: p.playerName, playerDob: p.playerDob,
      parentName, parentEmail, parentPhone,
      // snapshot: editing the form later must not change what was agreed to
      consentMd: season.consentMd,
      signedIp,
      levels: { create: p.chosen.map((l) => ({ levelId: l.id })) },
    },
    include: { levels: { include: { level: true } } },
  })))

  const summary = created.map((s) => ({
    playerName: s.playerName, levels: s.levels.map((x) => x.level.name),
  }))

  // One receipt for the whole family. sendMail never throws, and the signup is
  // already committed — a mail failure must not fail the submission.
  const mail = await sendMail({
    to: parentEmail,
    ...allStarSignupConfirmation({
      parentName, leagueName: season.league.name, year: season.year, players: summary,
    }),
  })
  if (!mail.ok) console.error(`[allstar] signup receipt to ${parentEmail} failed: ${mail.error || mail.reason}`)

  res.status(201).json({ ok: true, players: summary, email: parentEmail, emailed: !!mail.ok })
})

/* ============================================================================
   Ballots.

   Two factors: the personal link identifies the voter, and a code emailed to
   their address proves it is them. A forwarded link alone is not enough, which
   is the whole point of per-voter links.

   Verifying returns a short-lived key the page keeps for the session; ballot
   reads and writes carry it. The link stays valid for the cutoff window, the
   key does not.
   ========================================================================== */

const CODE_TTL_MIN = 20
const KEY_TTL_HOURS = 12
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

/** Fisher-Yates, so ballot position does not bias every voter the same way. */
function shuffle(a) {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function loadVoter(token) {
  if (!token) return null
  return prisma.allStarVoter.findUnique({
    where: { token }, include: { season: { include: { league: { select: { name: true } } } } },
  })
}

const votingClosed = (season) => !!season.votingClosesAt && new Date() > season.votingClosesAt

/** Who am I, is voting open, do I need a code? Emails a code on first open. */
publicRouter.get('/vote/:token', async (req, res) => {
  const v = await loadVoter(req.params.token)
  if (!v) return res.status(404).json({ error: 'This ballot link is not valid.' })
  res.json({
    voterName: v.name,
    maskedEmail: v.email.replace(/^(.).*(@.*)$/, (_, a, b) => `${a}•••${b}`),
    leagueName: v.season.league.name,
    year: v.season.year,
    votingClosesAt: v.season.votingClosesAt,
    closed: votingClosed(v.season),
  })
})

publicRouter.post('/vote/:token/request-code', async (req, res) => {
  const v = await loadVoter(req.params.token)
  if (!v) return res.status(404).json({ error: 'This ballot link is not valid.' })
  if (votingClosed(v.season)) return res.status(400).json({ error: 'Voting has closed.' })

  const code = sixDigits()
  await prisma.allStarVoter.update({
    where: { id: v.id },
    data: { codeHash: sha(code), codeSentAt: new Date(), codeExpiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000) },
  })
  const mail = await sendMail({ to: v.email, ...allStarVoteCode({ voterName: v.name, code, minutes: CODE_TTL_MIN }) })
  if (!mail.ok) console.error(`[allstar] code to ${v.email} failed: ${mail.error || mail.reason}`)
  res.json({ ok: true, sentTo: v.email.replace(/^(.).*(@.*)$/, (_, a, b) => `${a}•••${b}`) })
})

publicRouter.post('/vote/:token/verify', async (req, res) => {
  const v = await loadVoter(req.params.token)
  if (!v) return res.status(404).json({ error: 'This ballot link is not valid.' })
  const code = String(req.body?.code || '').trim()
  if (!v.codeHash || !v.codeExpiresAt || new Date() > v.codeExpiresAt)
    return res.status(400).json({ error: 'That code has expired. Ask for a new one.' })
  if (sha(code) !== v.codeHash) return res.status(400).json({ error: 'That code is not right.' })

  const key = crypto.randomBytes(24).toString('base64url')
  await prisma.allStarVoter.update({
    where: { id: v.id },
    data: {
      verifiedAt: new Date(), codeHash: sha(`key:${key}`),
      codeExpiresAt: new Date(Date.now() + KEY_TTL_HOURS * 3600_000),
    },
  })
  res.json({ ok: true, key })
})

/** The session key issued by /verify, re-checked on every ballot call. */
async function requireKey(req, res) {
  const v = await loadVoter(req.params.token)
  if (!v) { res.status(404).json({ error: 'This ballot link is not valid.' }); return null }
  const key = String(req.get('x-ballot-key') || req.query.key || req.body?.key || '')
  if (!key || !v.codeHash || v.codeHash !== sha(`key:${key}`) || !v.codeExpiresAt || new Date() > v.codeExpiresAt) {
    res.status(401).json({ error: 'Confirm the emailed code to continue.' })
    return null
  }
  return v
}

/** Every level this voter ranks, with their own ordering of the candidates. */
publicRouter.get('/vote/:token/ballots', async (req, res) => {
  const v = await requireKey(req, res); if (!v) return
  const levels = await prisma.allStarLevel.findMany({
    where: { seasonId: v.seasonId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { signups: { include: { signup: true } } },
  })

  const out = []
  for (const l of levels) {
    const candidates = l.signups.map((s) => ({ id: s.signup.id, name: s.signup.playerName }))
    let ballot = await prisma.allStarBallot.findFirst({ where: { voterId: v.id, levelId: l.id } })
    if (!ballot) {
      // First open: shuffle for this voter and persist, so the order they see
      // is stable across reloads but differs from the next coach's.
      ballot = await prisma.allStarBallot.create({
        data: { voterId: v.id, levelId: l.id, ordering: shuffle(candidates.map((c) => c.id)) },
      })
    } else {
      // keep the stored order usable when players are added or removed later
      const known = new Set(candidates.map((c) => c.id))
      const kept = (ballot.ordering || []).filter((id) => known.has(id))
      const added = shuffle(candidates.map((c) => c.id).filter((id) => !kept.includes(id)))
      const merged = [...kept, ...added]
      if (merged.length !== (ballot.ordering || []).length || added.length)
        ballot = await prisma.allStarBallot.update({ where: { id: ballot.id }, data: { ordering: merged } })
    }
    const byId = Object.fromEntries(candidates.map((c) => [c.id, c.name]))
    out.push({
      levelId: l.id, levelName: l.name,
      ranking: (ballot.ordering || []).map((id) => ({ id, name: byId[id] })),
      submittedAt: ballot.submittedAt, updatedAt: ballot.updatedAt,
    })
  }
  res.json({
    voterName: v.name, leagueName: v.season.league.name, year: v.season.year,
    votingClosesAt: v.season.votingClosesAt, closed: votingClosed(v.season), ballots: out,
  })
})

publicRouter.put('/vote/:token/ballot/:levelId', async (req, res) => {
  const v = await requireKey(req, res); if (!v) return
  if (votingClosed(v.season)) return res.status(400).json({ error: 'Voting has closed — this ballot is final.' })
  const levelId = parseInt(req.params.levelId, 10)
  const level = await prisma.allStarLevel.findFirst({ where: { id: levelId, seasonId: v.seasonId }, include: { signups: true } })
  if (!level) return res.status(404).json({ error: 'not found' })

  const valid = new Set(level.signups.map((s) => s.signupId))
  const ordering = (Array.isArray(req.body?.ordering) ? req.body.ordering : []).map(Number).filter((id) => valid.has(id))
  if (ordering.length !== valid.size) return res.status(400).json({ error: 'The ranking must include every candidate exactly once.' })
  if (new Set(ordering).size !== ordering.length) return res.status(400).json({ error: 'Duplicate entries in the ranking.' })

  const saved = await prisma.allStarBallot.upsert({
    where: { voterId_levelId: { voterId: v.id, levelId } },
    update: { ordering, ...(req.body?.submit ? { submittedAt: new Date() } : {}) },
    create: { voterId: v.id, levelId, ordering, ...(req.body?.submit ? { submittedAt: new Date() } : {}) },
  })
  res.json({ ok: true, updatedAt: saved.updatedAt, submittedAt: saved.submittedAt })
})
