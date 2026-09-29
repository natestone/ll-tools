import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, loadLeague } from '../middleware/auth.js'
import { canEditCategory } from '../lib/permissions.js'

export const meetingsRouter = Router({ mergeParams: true })
meetingsRouter.use(requireAuth, loadLeague)

const canEdit = (req) => canEditCategory(req.leagueId, req.membership, 'meetings')
const newId = () => Math.random().toString(36).slice(2, 10)

// Normalize an incoming agenda item into our stored shape.
const RESULTS = ['', 'carried', 'failed', 'tabled']
function normItem(raw) {
  const m = raw.motion || {}
  const hasMotion = [m.text, m.movedBy, m.secondedBy, m.result].some((v) => String(v ?? '').trim())
  return {
    id: raw.id || newId(),
    text: String(raw.text ?? '').slice(0, 2000),
    done: !!raw.done,
    source: raw.source || 'custom',       // task-step | standing | custom
    roleKey: raw.roleKey ?? null,
    taskId: raw.taskId ?? null,
    stepIndex: raw.stepIndex ?? null,
    // live minutes captured while the meeting is conducted
    notes: String(raw.notes ?? ''),
    motion: hasMotion ? {
      text: String(m.text ?? ''),
      movedBy: String(m.movedBy ?? ''),
      secondedBy: String(m.secondedBy ?? ''),
      result: RESULTS.includes(m.result) ? m.result : '',
    } : null,
  }
}

// ---- list / read ----
meetingsRouter.get('/', async (req, res) => {
  const rows = await prisma.boardMeeting.findMany({
    where: { leagueId: req.leagueId },
    orderBy: [{ meetingDate: 'desc' }, { id: 'desc' }],
  })
  res.json(rows.map((m) => ({ ...m, canEdit: undefined, itemCount: (m.items || []).length })))
})

meetingsRouter.get('/candidates', async (req, res) => {
  // Task steps near a fiscal-year week, to seed the agenda wizard.
  const week = req.query.week == null ? null : parseInt(req.query.week, 10)
  const roleKey = req.query.roleKey || null       // omit/"all" for every role
  const span = parseInt(req.query.span ?? '3', 10)
  const where = { leagueId: req.leagueId }
  if (roleKey && roleKey !== 'all') where.roleKey = roleKey
  if (week != null && !Number.isNaN(week))
    where.dueWeekOfFY = { gte: Math.max(0, week - span), lte: Math.min(51, week + span) }
  const tasks = await prisma.task.findMany({
    where, orderBy: [{ dueWeekOfFY: 'asc' }, { id: 'asc' }], take: 80,
  })
  res.json(tasks.map((t) => ({
    id: t.id, roleKey: t.roleKey, title: t.title, dueWeekOfFY: t.dueWeekOfFY, steps: t.steps || [],
  })))
})

meetingsRouter.get('/:id', async (req, res) => {
  const m = await prisma.boardMeeting.findFirst({
    where: { id: parseInt(req.params.id, 10), leagueId: req.leagueId },
  })
  if (!m) return res.status(404).json({ error: 'not found' })
  res.json({ ...m, canEdit: await canEdit(req) })
})

// ---- create (the wizard) ----
meetingsRouter.post('/', async (req, res) => {
  if (!(await canEdit(req))) return res.status(403).json({ error: 'not permitted' })
  const b = req.body || {}
  const m = await prisma.boardMeeting.create({
    data: {
      leagueId: req.leagueId,
      title: String(b.title || 'Board Meeting').slice(0, 500),
      meetingDate: b.meetingDate ? new Date(b.meetingDate) : null,
      startTime: b.startTime || null, location: b.location || null,
      facilitator: b.facilitator || null, recorder: b.recorder || null,
      attendees: b.attendees || null, notes: b.notes || null,
      status: 'draft',
      items: (b.items || []).map(normItem),
    },
  })
  res.status(201).json({ ...m, canEdit: true })
})

// ---- update header / items / notes / status ----
meetingsRouter.patch('/:id', async (req, res) => {
  if (!(await canEdit(req))) return res.status(403).json({ error: 'not permitted' })
  const id = parseInt(req.params.id, 10)
  const found = await prisma.boardMeeting.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!found) return res.status(404).json({ error: 'not found' })
  const b = req.body || {}
  const data = {}
  for (const f of ['title', 'startTime', 'location', 'facilitator', 'recorder', 'attendees', 'notes'])
    if (b[f] !== undefined) data[f] = b[f]
  if (b.meetingDate !== undefined) data.meetingDate = b.meetingDate ? new Date(b.meetingDate) : null
  if (b.status !== undefined) {
    if (!['draft', 'held'].includes(b.status)) return res.status(400).json({ error: 'bad status' })
    data.status = b.status
  }
  if (b.items !== undefined) data.items = (b.items || []).map(normItem)
  if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to update' })
  const m = await prisma.boardMeeting.update({ where: { id }, data })
  res.json({ ...m, canEdit: true })
})

// ---- append one item (the per-step "+ agenda" button) ----
meetingsRouter.post('/:id/items', async (req, res) => {
  if (!(await canEdit(req))) return res.status(403).json({ error: 'not permitted' })
  const id = parseInt(req.params.id, 10)
  const found = await prisma.boardMeeting.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!found) return res.status(404).json({ error: 'not found' })
  const items = [...(found.items || []), normItem(req.body || {})]
  const m = await prisma.boardMeeting.update({ where: { id }, data: { items } })
  res.json({ ...m, canEdit: true })
})

meetingsRouter.delete('/:id', async (req, res) => {
  if (!(await canEdit(req))) return res.status(403).json({ error: 'not permitted' })
  const id = parseInt(req.params.id, 10)
  const found = await prisma.boardMeeting.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!found) return res.status(404).json({ error: 'not found' })
  await prisma.boardMeeting.delete({ where: { id } })
  res.json({ ok: true })
})
