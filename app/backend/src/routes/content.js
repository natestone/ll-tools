import { Router } from 'express'
import { prisma, withLeague } from '../lib/prisma.js'
import { requireAuth, loadLeague } from '../middleware/auth.js'
import { canEditCategory } from '../lib/permissions.js'
import { currentSeasonYear } from './seasons.js'
import crypto from 'node:crypto'
import { effectiveDate, weekStartDate, isoDate, seriesWeeks, FREQUENCIES } from '../lib/fyweeks.js'

export const contentRouter = Router({ mergeParams: true })
contentRouter.use(requireAuth, loadLeague)

async function myRoleKeys(req) {
  const a = await prisma.officerAssignment.findMany({
    where: { leagueId: req.leagueId, membershipId: req.membership.id }, include: { role: true },
  })
  return a.map((x) => x.role.key)
}

// Resolve the roleKey filter honoring officer scoping.
// Owner: may request any role or all. Officer: limited to assigned roles.
async function scopeRoleFilter(req, res) {
  const requested = req.query.roleKey
  if (req.isOwner) return requested ? { roleKey: requested } : {}
  const keys = await myRoleKeys(req)
  if (requested) {
    if (!keys.includes(requested)) { res.status(403).json({ error: 'not your role' }); return null }
    return { roleKey: requested }
  }
  return { roleKey: { in: keys.length ? keys : ['__none__'] } }
}

// ---- Email templates ----
contentRouter.get('/email-templates', async (req, res) => {
  const where = await scopeRoleFilter(req, res); if (!where) return
  res.json(await withLeague(req.leagueId).emailTemplate.findMany({ where, orderBy: [{ category: 'asc' }, { id: 'asc' }] }))
})

contentRouter.patch('/email-templates/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const tpl = await prisma.emailTemplate.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!tpl) return res.status(404).json({ error: 'not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'email_templates', tpl.roleKey)))
    return res.status(403).json({ error: 'not permitted' })
  const { subject, bodyMd, name } = req.body || {}
  const upd = await prisma.emailTemplate.update({
    where: { id },
    data: { subject: subject ?? tpl.subject, bodyMd: bodyMd ?? tpl.bodyMd, name: name ?? tpl.name },
  })
  res.json(upd)
})

contentRouter.post('/email-templates/:id/reset', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const tpl = await prisma.emailTemplate.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!tpl || !tpl.seededFromId) return res.status(400).json({ error: 'no default to reset to' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'email_templates', tpl.roleKey)))
    return res.status(403).json({ error: 'not permitted' })
  // seededFromId points at the row in the Seed Organization this was cloned from
  const def = await prisma.emailTemplate.findUnique({ where: { id: tpl.seededFromId } })
  if (!def) return res.status(400).json({ error: 'default missing' })
  const upd = await prisma.emailTemplate.update({
    where: { id }, data: { subject: def.subject, bodyMd: def.bodyMd, name: def.name },
  })
  res.json(upd)
})

// ---- Agenda templates (league-wide) ----
contentRouter.get('/agenda-templates', async (req, res) => {
  res.json(await withLeague(req.leagueId).agendaTemplate.findMany({ orderBy: { id: 'asc' } }))
})

// ---- Calendar ----
contentRouter.get('/calendar', async (req, res) => {
  const where = await scopeRoleFilter(req, res); if (!where) return
  const season = seasonOf(req)
  const rows = await withLeague(req.leagueId).calendarItem.findMany({ where, orderBy: [{ weekOfFY: 'asc' }, { id: 'asc' }] })
  const canEdit = await canEditCategory(req.leagueId, req.membership, 'calendar')
  res.json(rows.map((c) => calWithDates(c, season, canEdit)))
})

/* Same shape tasks get: `dueDate` is the override when set, otherwise the Monday
   of the item's week. A calendar feed reads `dueDate` and nothing else. */
const calWithDates = (c, seasonYear, canEdit) => ({
  ...c,
  dueDate: isoDate(effectiveDate({ weekOfFY: c.weekOfFY, dueDateOverride: c.dateOverride }, seasonYear)),
  weekStartDate: isoDate(weekStartDate(seasonYear, c.weekOfFY)),
  isDateOverridden: !!c.dateOverride,
  canEdit,
})

// Move a calendar item: change its week, or pin it to an exact date.
contentRouter.patch('/calendar/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const item = await prisma.calendarItem.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!item) return res.status(404).json({ error: 'not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'calendar', item.roleKey)))
    return res.status(403).json({ error: 'not permitted' })

  const { weekOfFY, dateOverride, title, kind } = req.body || {}
  const data = {}
  if (weekOfFY !== undefined) {
    data.weekOfFY = Math.max(0, Math.min(51, parseInt(weekOfFY, 10) || 0))
    // a pin from the old week would keep the item on a date that no longer matches
    if (dateOverride === undefined) data.dateOverride = null
  }
  if (dateOverride !== undefined) data.dateOverride = dateOverride ? new Date(dateOverride) : null
  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ error: 'title required' })
    data.title = String(title).trim()
  }
  if (kind !== undefined) data.kind = String(kind)
  if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to update' })

  const updated = await prisma.calendarItem.update({ where: { id }, data })
  res.json(calWithDates(updated, seasonOf(req), true))
})

// ---- Tasks ----
// Which season a request is talking about (?season=YYYY, else the league's active one).
const seasonOf = (req) => {
  const q = parseInt(req.query.season, 10)
  if (Number.isInteger(q)) return q
  if (req.league.activeSeasonYear != null) return req.league.activeSeasonYear
  return currentSeasonYear()
}

/* Attach the real calendar date a task lands on.
   `dueDate` is what the UI shows and what a calendar feed must use: the override
   when set, otherwise the Monday of its fiscal week. `weekStartDate` is sent too
   so the UI can show what the default would be if the override were cleared. */
const withDates = (t, seasonYear) => ({
  ...t,
  dueDate: isoDate(effectiveDate(t, seasonYear)),
  weekStartDate: isoDate(weekStartDate(seasonYear, t.dueWeekOfFY)),
  isDateOverridden: !!t.dueDateOverride,
})

contentRouter.get('/tasks', async (req, res) => {
  const where = await scopeRoleFilter(req, res); if (!where) return
  where.seasonYear = seasonOf(req)
  // archived tasks are the "optional" pool — only returned when asked for
  where.archivedAt = req.query.archived === '1' ? { not: null } : null
  const season = where.seasonYear
  const rows = await withLeague(req.leagueId).task.findMany({ where, orderBy: [{ dueWeekOfFY: 'asc' }, { id: 'asc' }] })
  res.json(rows.map((t) => withDates(t, season)))
})

// Create a task for a role (the "+" on a role's task list)
contentRouter.post('/tasks', async (req, res) => {
  const { roleKey, title, description, dueWeekOfFY, dueDateOverride, details, steps, links } = req.body || {}
  if (!roleKey) return res.status(400).json({ error: 'roleKey required' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', roleKey)))
    return res.status(403).json({ error: 'not permitted' })
  const task = await prisma.task.create({
    data: {
      leagueId: req.leagueId, roleKey, seasonYear: seasonOf(req),
      title: String(title ?? 'New task').slice(0, 2000),
      description: String(description ?? ''),
      dueWeekOfFY: dueWeekOfFY == null ? null : Math.max(0, Math.min(51, parseInt(dueWeekOfFY, 10) || 0)),
      dueDateOverride: dueDateOverride ? new Date(dueDateOverride) : null,
      details: details ?? null, steps: steps ?? [], links: links ?? [], stepsDone: [], archivedSteps: [],
    },
  })
  res.status(201).json(withDates(task, task.seasonYear ?? seasonOf(req)))
})

// Restore an archived task back into the active list
contentRouter.post('/tasks/:id/restore', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const task = await prisma.task.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!task) return res.status(404).json({ error: 'not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', task.roleKey)))
    return res.status(403).json({ error: 'not permitted' })
  res.json(await prisma.task.update({ where: { id }, data: { archivedAt: null } }))
})

// Move an archived step back onto a task (optionally a different one)
contentRouter.post('/tasks/:id/steps/restore', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const { text, targetTaskId } = req.body || {}
  const from = await prisma.task.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!from) return res.status(404).json({ error: 'not found' })
  const target = targetTaskId
    ? await prisma.task.findFirst({ where: { id: parseInt(targetTaskId, 10), leagueId: req.leagueId } })
    : from
  if (!target) return res.status(404).json({ error: 'target task not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', target.roleKey)))
    return res.status(403).json({ error: 'not permitted' })

  const archived = (from.archivedSteps || []).filter((s) => s !== text)
  await prisma.task.update({ where: { id: from.id }, data: { archivedSteps: archived } })
  const updated = await prisma.task.update({
    where: { id: target.id }, data: { steps: [...(target.steps || []), String(text ?? '')] },
  })
  res.json(updated)
})

/* ---- Duplicate ----------------------------------------------------------
   Copies the task with its steps, links and details. Progress is NOT copied —
   a duplicate starts unticked — and the copy is deliberately detached from any
   recurring series, so duplicating one occurrence doesn't silently join it. */
contentRouter.post('/tasks/:id/duplicate', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const t = await prisma.task.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!t) return res.status(404).json({ error: 'not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', t.roleKey)))
    return res.status(403).json({ error: 'not permitted' })

  const copy = await prisma.task.create({
    data: {
      leagueId: req.leagueId, seasonYear: t.seasonYear, roleKey: t.roleKey,
      title: `${t.title} (copy)`, description: t.description, details: t.details,
      steps: t.steps ?? [], links: t.links ?? [],
      dueWeekOfFY: t.dueWeekOfFY, dueDateOverride: t.dueDateOverride,
      status: 'open', stepsDone: [], seededFromId: t.seededFromId,
    },
  })
  res.status(201).json(withDates(copy, copy.seasonYear ?? seasonOf(req)))
})

/* ---- Recurring series ---------------------------------------------------- */

// Turn a task into a recurring series: generate an occurrence per matching week
// through the end of the season. The original becomes the first occurrence.
contentRouter.post('/tasks/:id/recurrence', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const t = await prisma.task.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!t) return res.status(404).json({ error: 'not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', t.roleKey)))
    return res.status(403).json({ error: 'not permitted' })

  const frequency = String(req.body?.frequency || '')
  if (!FREQUENCIES.includes(frequency)) return res.status(400).json({ error: 'unknown frequency' })
  if (t.dueWeekOfFY == null) return res.status(400).json({ error: 'Give the task a due week before making it recurring.' })

  const season = t.seasonYear ?? seasonOf(req)
  const weeks = seriesWeeks(season, t.dueWeekOfFY, frequency)
  const seriesId = t.seriesId || crypto.randomUUID()
  const recurrence = { frequency, anchorWeek: t.dueWeekOfFY }

  // Replace any previous generated occurrences (keeping this one as the anchor)
  // so changing the frequency doesn't leave orphans behind.
  if (t.seriesId)
    await prisma.task.deleteMany({ where: { leagueId: req.leagueId, seriesId: t.seriesId, NOT: { id: t.id } } })

  await prisma.task.update({ where: { id: t.id }, data: { seriesId, recurrence } })
  const rest = weeks.filter((w) => w !== t.dueWeekOfFY)
  if (rest.length) await prisma.task.createMany({
    data: rest.map((w) => ({
      leagueId: req.leagueId, seasonYear: season, roleKey: t.roleKey,
      title: t.title, description: t.description, details: t.details,
      steps: t.steps ?? [], links: t.links ?? [],
      dueWeekOfFY: w, status: 'open', stepsDone: [],
      seriesId, recurrence, seededFromId: t.seededFromId,
    })),
  })
  res.json({ ok: true, seriesId, frequency, occurrences: weeks.length })
})

// Stop repeating. ?future=1 also deletes the untouched later occurrences.
contentRouter.delete('/tasks/:id/recurrence', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const t = await prisma.task.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!t?.seriesId) return res.status(404).json({ error: 'not a recurring task' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', t.roleKey)))
    return res.status(403).json({ error: 'not permitted' })

  let removed = 0
  if (req.query.future === '1') {
    // only occurrences nobody has started, so completed history is never destroyed
    const r = await prisma.task.deleteMany({
      where: { leagueId: req.leagueId, seriesId: t.seriesId, status: 'open',
        dueWeekOfFY: { gt: t.dueWeekOfFY ?? 0 } },
    })
    removed = r.count
  }
  await prisma.task.updateMany({
    where: { leagueId: req.leagueId, seriesId: t.seriesId }, data: { seriesId: null, recurrence: null },
  })
  res.json({ ok: true, removedFutureOccurrences: removed })
})

// Archive (soft delete) by default; ?hard=1 destroys it permanently.
contentRouter.delete('/tasks/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const task = await prisma.task.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!task) return res.status(404).json({ error: 'not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', task.roleKey)))
    return res.status(403).json({ error: 'not permitted' })
  if (req.query.hard !== '1') {
    const t = await prisma.task.update({ where: { id }, data: { archivedAt: new Date() } })
    return res.json({ ok: true, archived: true, task: t })
  }
  await prisma.task.delete({ where: { id } })
  res.json({ ok: true })
})

contentRouter.patch('/tasks/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const task = await prisma.task.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!task) return res.status(404).json({ error: 'not found' })
  if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', task.roleKey)))
    return res.status(403).json({ error: 'not permitted' })
  const { status, stepsDone, details, steps, links, title, description, dueWeekOfFY, dueDateOverride, archiveStep, roleKey } = req.body || {}
  const applyToSeries = req.body?.applyToSeries === true || req.query.applyToSeries === '1'
  const data = {}
  // A removed step is archived (not destroyed) so a later season can pull it back.
  if (archiveStep !== undefined && String(archiveStep).trim())
    data.archivedSteps = [...(task.archivedSteps || []), String(archiveStep)]
  if (status !== undefined) {
    if (!['open', 'done', 'skipped'].includes(status)) return res.status(400).json({ error: 'bad status' })
    data.status = status
  }
  if (stepsDone !== undefined) data.stepsDone = Array.isArray(stepsDone) ? stepsDone : []
  if (details !== undefined) data.details = details
  if (steps !== undefined) data.steps = steps
  if (links !== undefined) data.links = links
  if (req.body?.archivedSteps !== undefined) data.archivedSteps = req.body.archivedSteps || []
  if (title !== undefined) data.title = String(title).slice(0, 2000)
  if (description !== undefined) data.description = String(description)
  if (dueWeekOfFY !== undefined) {
    data.dueWeekOfFY = dueWeekOfFY === null ? null : Math.max(0, Math.min(51, parseInt(dueWeekOfFY, 10) || 0))
    // Moving the week discards a stale pinned date — an override from the old
    // week would silently keep the task on a date that no longer matches it.
    if (dueDateOverride === undefined) data.dueDateOverride = null
  }
  // null clears the pin and falls back to the week's start date
  if (dueDateOverride !== undefined)
    data.dueDateOverride = dueDateOverride ? new Date(dueDateOverride) : null

  /* Reassign the task to a different role. Checked against the TARGET role too:
     otherwise anyone who can edit their own role's tasks could push work onto a
     role they have no rights over. */
  if (roleKey !== undefined && roleKey !== task.roleKey) {
    const target = await prisma.role.findFirst({ where: { leagueId: req.leagueId, key: String(roleKey) } })
    if (!target) return res.status(400).json({ error: 'unknown role' })
    if (!(await canEditCategory(req.leagueId, req.membership, 'tasks', target.key)))
      return res.status(403).json({ error: `You can't move tasks into ${target.name}.` })
    data.roleKey = target.key
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'nothing to update' })
  const updated = await prisma.task.update({ where: { id }, data })

  /* Propagate to the rest of the series when asked.

     Only shared content travels: title, description, details, steps, links.
     Per-occurrence fields (which week it falls on, whether it's done, which
     steps are ticked) stay local — that is the whole point of having separate
     occurrences.

     A sibling is skipped if the field has been customised there, compared
     against THIS task's pre-edit value. Without that check, editing one
     occurrence would quietly wipe deliberate per-occurrence wording. */
  let series = null
  if (applyToSeries && task.seriesId) {
    const SHARED = ['title', 'description', 'details', 'steps', 'links']
    const shared = Object.fromEntries(Object.entries(data).filter(([k]) => SHARED.includes(k)))
    if (Object.keys(shared).length) {
      const siblings = await prisma.task.findMany({
        where: { leagueId: req.leagueId, seriesId: task.seriesId, NOT: { id } },
      })
      const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
      let changed = 0, skipped = 0
      for (const sib of siblings) {
        const patch = {}
        for (const [k, v] of Object.entries(shared)) {
          if (same(sib[k], task[k])) patch[k] = v   // untouched here -> safe to update
          else skipped++
        }
        if (Object.keys(patch).length) { await prisma.task.update({ where: { id: sib.id }, data: patch }); changed++ }
      }
      series = { total: siblings.length + 1, updated: changed, skipped }
    }
  }

  res.json({ ...withDates(updated, updated.seasonYear ?? seasonOf(req)), series })
})

// ---- Policies & references (readable by all members) ----
contentRouter.get('/policies', async (req, res) => {
  res.json(await withLeague(req.leagueId).policyDocument.findMany({ orderBy: { slug: 'asc' }, select: { id: true, slug: true, title: true } }))
})
contentRouter.get('/policies/:slug', async (req, res) => {
  const doc = await prisma.policyDocument.findFirst({ where: { leagueId: req.leagueId, slug: req.params.slug } })
  if (!doc) return res.status(404).json({ error: 'not found' })
  const canEdit = await canEditCategory(req.leagueId, req.membership, 'policies')
  res.json({ ...doc, canEdit })
})
contentRouter.patch('/policies/:slug', async (req, res) => {
  if (!(await canEditCategory(req.leagueId, req.membership, 'policies')))
    return res.status(403).json({ error: 'not permitted' })
  const { title, bodyMd } = req.body || {}
  const r = await prisma.policyDocument.updateMany({
    where: { leagueId: req.leagueId, slug: req.params.slug },
    data: { ...(title !== undefined ? { title } : {}), ...(bodyMd !== undefined ? { bodyMd } : {}) },
  })
  if (!r.count) return res.status(404).json({ error: 'not found' })
  const doc = await prisma.policyDocument.findFirst({ where: { leagueId: req.leagueId, slug: req.params.slug } })
  res.json({ ...doc, canEdit: true })
})
contentRouter.get('/references', async (req, res) => {
  const canEdit = await canEditCategory(req.leagueId, req.membership, 'references')
  const docs = await withLeague(req.leagueId).referenceDoc.findMany({ orderBy: { slug: 'asc' } })
  res.json(docs.map((d) => ({ ...d, canEdit })))
})
contentRouter.patch('/references/:slug', async (req, res) => {
  if (!(await canEditCategory(req.leagueId, req.membership, 'references')))
    return res.status(403).json({ error: 'not permitted' })
  const { title, bodyMd } = req.body || {}
  const r = await prisma.referenceDoc.updateMany({
    where: { leagueId: req.leagueId, slug: req.params.slug },
    data: { ...(title !== undefined ? { title } : {}), ...(bodyMd !== undefined ? { bodyMd } : {}) },
  })
  if (!r.count) return res.status(404).json({ error: 'not found' })
  const doc = await prisma.referenceDoc.findFirst({ where: { leagueId: req.leagueId, slug: req.params.slug } })
  res.json({ ...doc, canEdit: true })
})

// ---- Owner dashboard: roles + task completion + calendar counts ----
contentRouter.get('/dashboard', async (req, res) => {
  if (!req.isOwner) return res.status(403).json({ error: 'owner only' })
  const roles = await prisma.role.findMany({ where: { leagueId: req.leagueId }, orderBy: { id: 'asc' } })
  const tasks = await prisma.task.groupBy({ by: ['roleKey', 'status'], where: { leagueId: req.leagueId }, _count: true })
  const cal = await prisma.calendarItem.groupBy({ by: ['roleKey'], where: { leagueId: req.leagueId }, _count: true })
  const members = await prisma.membership.findMany({
    where: { leagueId: req.leagueId, status: 'active' },
    include: { user: { select: { displayName: true } }, assignments: { include: { role: true } } },
  })
  const byRole = roles.map((r) => {
    const rt = tasks.filter((t) => t.roleKey === r.key)
    const total = rt.reduce((n, x) => n + x._count, 0)
    const done = rt.filter((x) => x.status === 'done').reduce((n, x) => n + x._count, 0)
    const holders = members.filter((m) => m.assignments.some((a) => a.role.key === r.key)).map((m) => m.user.displayName)
    return { key: r.key, name: r.name, taskTotal: total, taskDone: done,
      calendarCount: cal.find((c) => c.roleKey === r.key)?._count || 0, holders }
  })
  res.json({ league: { name: req.league.name }, roles: byRole,
    memberCount: members.length,
    taskTotals: { total: tasks.reduce((n, x) => n + x._count, 0), done: tasks.filter((t) => t.status === 'done').reduce((n, x) => n + x._count, 0) } })
})
