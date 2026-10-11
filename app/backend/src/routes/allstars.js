import { Router } from 'express'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { requireAuth, loadLeague } from '../middleware/auth.js'
import { canEditCategory } from '../lib/permissions.js'
import { sendMail } from '../lib/mailer.js'
import { allStarBallotInvite } from '../lib/emails.js'

/* ============================================================================
   All-Star voting — league-side administration.

   One season per league per calendar year. A season owns its levels (each with
   the birthdate window that makes a player eligible), the consent text parents
   sign, the voter roster, and the voting cutoff.

   The public signup and ballot endpoints live in routes/public.js and carry no
   session at all — they are reached by unguessable token.
   ========================================================================== */

export const allStarsRouter = Router({ mergeParams: true })
allStarsRouter.use(requireAuth, loadLeague)

const canManage = (req) => canEditCategory(req.leagueId, req.membership, 'all_stars')
const DEFAULT_CONSENT = `## All-Star Participation Consent & Agreement

By signing below I confirm that I am the parent or legal guardian of the player
named above, and that:

- The player is available for the full All-Star commitment, including practices,
  tournament play and any travel it requires.
- I understand selection is not guaranteed by signing up.
- I will make the player available for the published practice schedule.

_Type your full name below to sign._`

const slug = () => crypto.randomBytes(9).toString('base64url')
const dateOnly = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : null)

/** The current season for this league, created on first use. */
async function ensureSeason(leagueId, year) {
  const found = await prisma.allStarSeason.findFirst({ where: { leagueId, year } })
  if (found) return found
  return prisma.allStarSeason.create({
    data: { leagueId, year, publicSlug: slug(), consentMd: DEFAULT_CONSENT },
  })
}

const yearOf = (req) => parseInt(req.query.year, 10) || new Date().getFullYear()

allStarsRouter.get('/', async (req, res) => {
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const [levels, signups, voters] = await Promise.all([
    prisma.allStarLevel.findMany({ where: { seasonId: season.id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.allStarSignup.count({ where: { seasonId: season.id } }),
    prisma.allStarVoter.count({ where: { seasonId: season.id } }),
  ])
  res.json({
    ...season, levels, counts: { signups, voters },
    canManage: await canManage(req),
    years: (await prisma.allStarSeason.findMany({
      where: { leagueId: req.leagueId }, select: { year: true }, orderBy: { year: 'desc' },
    })).map((s) => s.year),
  })
})

allStarsRouter.patch('/', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const data = {}
  if (req.body?.consentMd !== undefined) data.consentMd = String(req.body.consentMd)
  if (req.body?.signupOpen !== undefined) data.signupOpen = !!req.body.signupOpen
  if (req.body?.votingClosesAt !== undefined)
    data.votingClosesAt = req.body.votingClosesAt ? new Date(req.body.votingClosesAt) : null
  if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to update' })
  res.json(await prisma.allStarSeason.update({ where: { id: season.id }, data }))
})

// Rotate the public link if it gets shared somewhere it shouldn't be.
allStarsRouter.post('/rotate-link', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const season = await ensureSeason(req.leagueId, yearOf(req))
  res.json(await prisma.allStarSeason.update({ where: { id: season.id }, data: { publicSlug: slug() } }))
})

/* ---- levels -------------------------------------------------------------- */

allStarsRouter.post('/levels', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const name = String(req.body?.name || '').trim()
  const bornFrom = dateOnly(req.body?.bornFrom), bornTo = dateOnly(req.body?.bornTo)
  if (!name) return res.status(400).json({ error: 'name required' })
  if (!bornFrom || !bornTo) return res.status(400).json({ error: 'both birthdate bounds are required' })
  if (bornFrom > bornTo) return res.status(400).json({ error: 'the earliest birthdate must come first' })
  const count = await prisma.allStarLevel.count({ where: { seasonId: season.id } })
  res.status(201).json(await prisma.allStarLevel.create({
    data: { seasonId: season.id, name, bornFrom, bornTo, sortOrder: count },
  }))
})

allStarsRouter.patch('/levels/:id', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const id = parseInt(req.params.id, 10)
  const lvl = await prisma.allStarLevel.findFirst({ where: { id }, include: { season: true } })
  if (!lvl || lvl.season.leagueId !== req.leagueId) return res.status(404).json({ error: 'not found' })
  const data = {}
  if (req.body?.name !== undefined) {
    if (!String(req.body.name).trim()) return res.status(400).json({ error: 'name required' })
    data.name = String(req.body.name).trim()
  }
  if (req.body?.bornFrom !== undefined) data.bornFrom = dateOnly(req.body.bornFrom)
  if (req.body?.bornTo !== undefined) data.bornTo = dateOnly(req.body.bornTo)
  if (req.body?.sortOrder !== undefined) data.sortOrder = parseInt(req.body.sortOrder, 10) || 0
  const from = data.bornFrom ?? lvl.bornFrom, to = data.bornTo ?? lvl.bornTo
  if (from > to) return res.status(400).json({ error: 'the earliest birthdate must come first' })
  res.json(await prisma.allStarLevel.update({ where: { id }, data }))
})

allStarsRouter.delete('/levels/:id', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const id = parseInt(req.params.id, 10)
  const lvl = await prisma.allStarLevel.findFirst({ where: { id }, include: { season: true } })
  if (!lvl || lvl.season.leagueId !== req.leagueId) return res.status(404).json({ error: 'not found' })
  const signups = await prisma.allStarSignupLevel.count({ where: { levelId: id } })
  if (signups && req.query.force !== '1')
    return res.status(409).json({ error: `${signups} player(s) already signed up for that level.`, signups })
  await prisma.allStarLevel.delete({ where: { id } })
  res.json({ ok: true, removedSignupLinks: signups })
})

/* ---- signups (read-only here; parents create them publicly) -------------- */

allStarsRouter.get('/signups', async (req, res) => {
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const rows = await prisma.allStarSignup.findMany({
    where: { seasonId: season.id },
    include: { levels: { include: { level: true } } },
    orderBy: { signedAt: 'desc' },
  })
  res.json(rows.map((s) => ({
    id: s.id, playerName: s.playerName, playerDob: s.playerDob, parentName: s.parentName,
    parentEmail: s.parentEmail, parentPhone: s.parentPhone, signedAt: s.signedAt,
    levels: s.levels.map((l) => ({ id: l.level.id, name: l.level.name })),
  })))
})

allStarsRouter.delete('/signups/:id', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const id = parseInt(req.params.id, 10)
  const row = await prisma.allStarSignup.findFirst({ where: { id }, include: { season: true } })
  if (!row || row.season.leagueId !== req.leagueId) return res.status(404).json({ error: 'not found' })
  await prisma.allStarSignup.delete({ where: { id } })
  res.json({ ok: true })
})

/* ---- voters -------------------------------------------------------------- */

allStarsRouter.get('/voters', async (req, res) => {
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const rows = await prisma.allStarVoter.findMany({
    where: { seasonId: season.id }, orderBy: { name: 'asc' },
    include: { ballots: { select: { levelId: true, submittedAt: true, updatedAt: true } } },
  })
  // the token is deliberately never returned to the browser in the list: it is
  // the voter's credential and only ever travels to them by email
  res.json(rows.map((v) => ({
    id: v.id, name: v.name, email: v.email,
    invitedAt: v.invitedAt, verifiedAt: v.verifiedAt,
    started: v.ballots.length, submitted: v.ballots.filter((b) => b.submittedAt).length,
    lastActivity: v.ballots.reduce((a, b) => (!a || b.updatedAt > a ? b.updatedAt : a), null),
  })))
})

allStarsRouter.post('/voters', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const name = String(req.body?.name || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!name) return res.status(400).json({ error: 'name required' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'a valid email is required' })
  if (await prisma.allStarVoter.findFirst({ where: { seasonId: season.id, email } }))
    return res.status(409).json({ error: 'That email is already on the voter list.' })
  const v = await prisma.allStarVoter.create({
    data: { seasonId: season.id, name, email, token: crypto.randomBytes(24).toString('base64url') },
  })
  res.status(201).json({ id: v.id, name: v.name, email: v.email })
})

allStarsRouter.delete('/voters/:id', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const id = parseInt(req.params.id, 10)
  const v = await prisma.allStarVoter.findFirst({ where: { id }, include: { season: true } })
  if (!v || v.season.leagueId !== req.leagueId) return res.status(404).json({ error: 'not found' })
  await prisma.allStarVoter.delete({ where: { id } })
  res.json({ ok: true })
})

/* Send every voter their personal ballot link.

   Nothing goes out until this is pressed, and only to voters who have not been
   invited yet unless ?resend=1 — pressing twice should not spam the coaches. */
allStarsRouter.post('/send-invites', async (req, res) => {
  if (!(await canManage(req))) return res.status(403).json({ error: 'not permitted' })
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const league = await prisma.league.findUnique({ where: { id: req.leagueId }, select: { name: true } })
  const resend = req.query.resend === '1'
  const voters = await prisma.allStarVoter.findMany({
    where: { seasonId: season.id, ...(resend ? {} : { invitedAt: null }) },
  })
  if (!voters.length) return res.json({ ok: true, sent: 0, message: resend ? 'No voters.' : 'Everyone has already been invited.' })

  const base = (process.env.APP_URL || process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '')
  const results = []
  for (const v of voters) {
    const mail = await sendMail({
      to: v.email,
      ...allStarBallotInvite({
        voterName: v.name, leagueName: league.name, year: season.year,
        url: `${base}/vote/${v.token}`, closesAt: season.votingClosesAt,
      }),
    })
    if (mail.ok) await prisma.allStarVoter.update({ where: { id: v.id }, data: { invitedAt: new Date() } })
    results.push({ email: v.email, ok: mail.ok, reason: mail.reason || mail.error })
  }
  await prisma.allStarSeason.update({ where: { id: season.id }, data: { invitesSentAt: new Date() } })
  res.json({ ok: true, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), results })
})

/* ---- results ------------------------------------------------------------- */

/* Borda count, matching the old tally.py: with N candidates on a level, a first
   place is worth N points, second N-1, down to 1. Players a coach left off the
   bottom of their ballot still score, because the ballot is a full ordering. */
allStarsRouter.get('/results', async (req, res) => {
  const season = await ensureSeason(req.leagueId, yearOf(req))
  const levels = await prisma.allStarLevel.findMany({
    where: { seasonId: season.id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { signups: { include: { signup: true } }, ballots: { include: { voter: true } } },
  })
  res.json(levels.map((l) => {
    const names = Object.fromEntries(l.signups.map((s) => [s.signup.id, s.signup.playerName]))
    const n = l.signups.length
    const points = {}, appearances = {}
    // Only SUBMITTED ballots count. A ballot row is created the moment a coach
    // opens the page, and its ordering is the random shuffle they were shown —
    // counting those would feed noise straight into the standings.
    for (const b of l.ballots.filter((x) => x.submittedAt)) {
      const order = Array.isArray(b.ordering) ? b.ordering : []
      order.forEach((sid, i) => {
        if (!(sid in names)) return          // a player removed after voting began
        points[sid] = (points[sid] || 0) + Math.max(0, n - i)
        appearances[sid] = (appearances[sid] || 0) + 1
      })
    }
    const standings = Object.keys(names).map((sid) => ({
      signupId: Number(sid), playerName: names[sid],
      points: points[sid] || 0, ballots: appearances[sid] || 0,
    })).sort((a, b) => b.points - a.points || a.playerName.localeCompare(b.playerName))
    return {
      levelId: l.id, levelName: l.name, candidates: n,
      ballotsCast: l.ballots.filter((b) => b.submittedAt).length,
      ballotsStarted: l.ballots.length,
      standings,
    }
  }))
})
