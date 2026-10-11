import { Router } from 'express'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { requireAuth, loadLeague } from '../middleware/auth.js'
import { canEditCategory } from '../lib/permissions.js'

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
