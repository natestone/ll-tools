import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, loadLeague, requireOwner } from '../middleware/auth.js'
import { shiftOverrideToSeason, currentSeasonYear } from '../lib/fyweeks.js'

export const seasonsRouter = Router({ mergeParams: true })
seasonsRouter.use(requireAuth, loadLeague)

// Defined in lib/fyweeks.js with the rest of the fiscal-year date math; re-exported
// here because routes have always imported it from this module.
export { currentSeasonYear }
const bounds = (y) => ({ fyStart: new Date(y, 9, 1), fyEnd: new Date(y + 1, 8, 30) })

// Ensure a Season row exists; returns it.
export async function ensureSeason(leagueId, year) {
  const found = await prisma.season.findFirst({ where: { leagueId, seasonYear: year } })
  if (found) return found
  return prisma.season.create({ data: { leagueId, seasonYear: year, ...bounds(year) } })
}

seasonsRouter.get('/', async (req, res) => {
  const seasons = await prisma.season.findMany({
    where: { leagueId: req.leagueId }, orderBy: { seasonYear: 'desc' },
  })
  const counts = await prisma.task.groupBy({
    by: ['seasonYear'], where: { leagueId: req.leagueId }, _count: true,
  })
  const byYear = Object.fromEntries(counts.map((c) => [c.seasonYear, c._count]))
  res.json({
    activeSeasonYear: req.league.activeSeasonYear ?? currentSeasonYear(),
    canManage: req.isOwner,
    seasons: seasons.map((s) => ({
      seasonYear: s.seasonYear,
      label: `${s.seasonYear}–${String(s.seasonYear + 1).slice(2)}`,
      taskCount: byYear[s.seasonYear] || 0,
    })),
  })
})

// Switch which season the league is working in.
seasonsRouter.patch('/active', requireOwner, async (req, res) => {
  const year = parseInt(req.body?.seasonYear, 10)
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'seasonYear required' })
  await ensureSeason(req.leagueId, year)
  await prisma.league.update({ where: { id: req.leagueId }, data: { activeSeasonYear: year } })
  res.json({ activeSeasonYear: year })
})

// Roll the whole task template into the next season.
// Active tasks are copied with progress reset; archived ones are copied still
// archived so each season carries its own pool of optional items.
seasonsRouter.post('/rollover', requireOwner, async (req, res) => {
  // The seed organization holds one notional season that clone maps onto each new
  // league; rolling it forward would just orphan the template's tasks.
  if (req.league.isSeed)
    return res.status(400).json({ error: 'The seed organization does not roll over.' })
  const from = parseInt(req.body?.fromYear, 10) || req.league.activeSeasonYear || currentSeasonYear()
  const to = parseInt(req.body?.toYear, 10) || from + 1

  const existing = await prisma.task.count({ where: { leagueId: req.leagueId, seasonYear: to } })
  if (existing > 0 && !req.body?.force)
    return res.status(409).json({ error: `season ${to} already has ${existing} tasks`, existing })

  const source = await prisma.task.findMany({ where: { leagueId: req.leagueId, seasonYear: from } })
  if (!source.length) return res.status(400).json({ error: `no tasks found in season ${from}` })

  await ensureSeason(req.leagueId, to)
  await prisma.task.createMany({
    data: source.map((t) => ({
      leagueId: req.leagueId, seasonYear: to, roleKey: t.roleKey,
      title: t.title, description: t.description, details: t.details,
      steps: t.steps ?? [], links: t.links ?? [],
      archivedSteps: t.archivedSteps ?? [],
      archivedAt: t.archivedAt,          // optional items stay optional
      dueWeekOfFY: t.dueWeekOfFY,
      // The week -> date map supplies next season's dates automatically. A task
      // that was pinned to a specific day keeps its offset within the week, so
      // "the Thursday of week 12" stays a Thursday instead of drifting to
      // whatever weekday that calendar date happens to be a year later.
      dueDateOverride: shiftOverrideToSeason(t.dueDateOverride, t.dueWeekOfFY, from, to),
      status: 'open', stepsDone: [],     // progress resets each season
      seededFromId: t.seededFromId,
    })),
  })
  await prisma.league.update({ where: { id: req.leagueId }, data: { activeSeasonYear: to } })

  const archived = source.filter((t) => t.archivedAt).length
  res.json({ fromYear: from, toYear: to, copied: source.length, active: source.length - archived, archived, activeSeasonYear: to })
})
