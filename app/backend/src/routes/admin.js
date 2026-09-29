import { Router } from 'express'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { requireSuperAdmin } from '../middleware/auth.js'
import { cloneSeed, getSeedLeague } from '../lib/cloneSeed.js'
import { seedDefaultPermissions } from '../lib/permissions.js'
import { sendMail } from '../lib/mailer.js'
import { leagueInvite } from '../lib/emails.js'
import { unsuppress, normalizeEmail } from '../lib/unsubscribe.js'

/* ============================================================================
   Super-admin tools. Platform-operator surface, above any single league:
   create leagues and invite their owner, manage the email suppression list,
   and promote other super admins.
   ========================================================================== */

export const adminRouter = Router()
adminRouter.use(requireSuperAdmin)

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

/* ---- overview ----------------------------------------------------------- */

adminRouter.get('/overview', async (_req, res) => {
  const [leagues, users, suppressed, seed] = await Promise.all([
    // the template is not a customer organization
    prisma.league.count({ where: { isSeed: false } }),
    prisma.user.count(), prisma.emailSuppression.count(), getSeedLeague(),
  ])
  let seedCounts = null
  if (seed) {
    const where = { leagueId: seed.id }
    const [tasks, emailTemplates, policies, calendarItems] = await Promise.all([
      prisma.task.count({ where }), prisma.emailTemplate.count({ where }),
      prisma.policyDocument.count({ where }), prisma.calendarItem.count({ where }),
    ])
    seedCounts = { id: seed.id, name: seed.name, tasks, emailTemplates, policies, calendarItems }
  }
  res.json({ leagues, users, suppressed, seed: seedCounts })
})

/* ---- leagues (organizations) -------------------------------------------- */

adminRouter.get('/leagues', async (_req, res) => {
  const leagues = await prisma.league.findMany({
    where: { isSeed: false },   // the template is listed on its own, not as an org
    orderBy: { id: 'desc' },
    select: { id: true, name: true, slug: true, ownerUserId: true, createdAt: true,
      _count: { select: { memberships: true } } },
  })
  const owners = await prisma.user.findMany({
    where: { id: { in: leagues.map((l) => l.ownerUserId).filter(Boolean) } },
    select: { id: true, email: true, displayName: true },
  })
  const byId = Object.fromEntries(owners.map((o) => [o.id, o]))
  res.json(leagues.map((l) => ({
    id: l.id, name: l.name, slug: l.slug, createdAt: l.createdAt,
    memberCount: l._count.memberships, owner: byId[l.ownerUserId] || null,
  })))
})

/**
 * Create a league and invite its owner.
 *
 * The owner usually has no account yet, so we don't create a placeholder user —
 * we issue the same invite token the normal flow uses, marked isOwnerInvite, and
 * ownership transfers when they redeem it. That reuses the invite-accept page
 * (which can already sign someone up) instead of inventing a second path.
 */
adminRouter.post('/leagues', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const ownerEmail = normalizeEmail(req.body?.ownerEmail)
  if (!name) return res.status(400).json({ error: 'league name required' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return res.status(400).json({ error: 'a valid owner email is required' })

  let slug = slugify(name) || 'league'
  if (await prisma.league.findUnique({ where: { slug } })) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`

  // The creating super admin owns it until the invited owner accepts, so the
  // league is never ownerless (every league route resolves an owner).
  const league = await prisma.league.create({
    data: { name, slug, ownerUserId: req.session.userId },
  })
  await cloneSeed(league.id)
  await seedDefaultPermissions(league.id)

  const token = crypto.randomBytes(24).toString('hex')
  const invite = await prisma.invite.create({
    data: {
      leagueId: league.id, email: ownerEmail, roleKeys: ['president'],
      tokenHash: sha256(token), invitedByUserId: req.session.userId,
      isOwnerInvite: true,
      expiresAt: new Date(Date.now() + 30 * 864e5),
    },
  })

  const inviter = await prisma.user.findUnique({
    where: { id: req.session.userId }, select: { displayName: true },
  })
  const mail = await sendMail({
    to: ownerEmail,
    ...leagueInvite({
      leagueName: league.name, inviterName: inviter?.displayName,
      roleNames: ['President'], token, expiresAt: invite.expiresAt,
    }),
  })

  res.json({
    league: { id: league.id, name: league.name, slug: league.slug },
    ownerEmail,
    acceptUrl: `${process.env.APP_URL || process.env.CLIENT_ORIGIN}/invite/accept?token=${token}`,
    emailed: mail.ok,
    emailError: mail.ok ? undefined : (mail.reason || mail.error),
  })
})

/* ---- email suppression list --------------------------------------------- */

// Super admins may browse the whole list; league owners only get exact-match
// lookup (see the league-scoped route in leagues.js).
adminRouter.get('/suppressions', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase()
  const rows = await prisma.emailSuppression.findMany({
    where: q ? { email: { contains: q } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json(rows)
})

adminRouter.delete('/suppressions', async (req, res) => {
  const email = normalizeEmail(req.body?.email || req.query.email)
  if (!email) return res.status(400).json({ error: 'email required' })
  const r = await unsuppress(email)
  res.json({ ok: true, email, removed: r.count })
})

/* ---- super admins -------------------------------------------------------- */

adminRouter.get('/admins', async (_req, res) => {
  res.json(await prisma.user.findMany({
    where: { isSuperAdmin: true },
    select: { id: true, email: true, displayName: true, createdAt: true },
    orderBy: { id: 'asc' },
  }))
})

adminRouter.post('/admins', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(404).json({ error: 'No account with that email. They must register first.' })
  await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } })
  res.json({ ok: true, user: { id: user.id, email: user.email, displayName: user.displayName } })
})

adminRouter.delete('/admins/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (id === req.session.userId)
    return res.status(400).json({ error: "You can't remove your own super-admin access." })
  // Never let the last super admin be removed — that locks everyone out of the
  // admin surface permanently, with no in-app way to restore it.
  const count = await prisma.user.count({ where: { isSuperAdmin: true } })
  if (count <= 1) return res.status(400).json({ error: 'At least one super admin must remain.' })
  await prisma.user.update({ where: { id }, data: { isSuperAdmin: false } })
  res.json({ ok: true })
})
