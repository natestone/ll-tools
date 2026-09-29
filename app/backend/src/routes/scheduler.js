import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, loadLeague } from '../middleware/auth.js'

// Per-user, per-league scheduler state. Any active member has their own.
export const schedulerRouter = Router({ mergeParams: true })
schedulerRouter.use(requireAuth, loadLeague)

const keyFor = (req) => ({ leagueId_userId: { leagueId: req.leagueId, userId: req.session.userId } })

// Load current state (preferences + last saved schedule + view)
schedulerRouter.get('/', async (req, res) => {
  const s = await prisma.schedulerState.findUnique({ where: keyFor(req) })
  res.json(s
    ? { preferences: s.preferences, schedule: s.schedule, view: s.view, updatedAt: s.updatedAt }
    : { preferences: null, schedule: null, view: 'list', updatedAt: null })
})

// Auto-save preferences (form config) + view
schedulerRouter.put('/preferences', async (req, res) => {
  const { preferences, view } = req.body || {}
  const s = await prisma.schedulerState.upsert({
    where: keyFor(req),
    update: { preferences: preferences ?? undefined, view: view || undefined },
    create: { leagueId: req.leagueId, userId: req.session.userId, preferences: preferences ?? null, view: view || 'list' },
  })
  res.json({ ok: true, updatedAt: s.updatedAt })
})

// Explicit "Save Schedule" — snapshot the generated schedule in exact state
schedulerRouter.put('/schedule', async (req, res) => {
  const { schedule } = req.body || {}
  const s = await prisma.schedulerState.upsert({
    where: keyFor(req),
    update: { schedule: schedule ?? null },
    create: { leagueId: req.leagueId, userId: req.session.userId, schedule: schedule ?? null },
  })
  res.json({ ok: true, savedAt: s.updatedAt })
})

// Clear saved schedule only (keep preferences)
schedulerRouter.delete('/schedule', async (req, res) => {
  await prisma.schedulerState.updateMany({
    where: { leagueId: req.leagueId, userId: req.session.userId }, data: { schedule: null },
  })
  res.json({ ok: true })
})

// Start fresh — clear everything for this user in this league
schedulerRouter.delete('/', async (req, res) => {
  await prisma.schedulerState.deleteMany({ where: { leagueId: req.leagueId, userId: req.session.userId } })
  res.json({ ok: true })
})
