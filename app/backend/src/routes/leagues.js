import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { sharedStore } from '../lib/rateLimitStore.js'
import { prisma, withLeague } from '../lib/prisma.js'
import { cloneSeed } from '../lib/cloneSeed.js'
import { seedDefaultPermissions, listEditable } from '../lib/permissions.js'
import { requireAuth, loadLeague, requireOwner } from '../middleware/auth.js'
import { sendMail } from '../lib/mailer.js'
import { leagueInvite } from '../lib/emails.js'

export const leaguesRouter = Router()

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

async function myRoles(leagueId, membershipId) {
  const a = await prisma.officerAssignment.findMany({
    where: { leagueId, membershipId }, include: { role: true },
  })
  return a.map((x) => x.role)
}

// Create a league -> caller becomes owner; seed is cloned; owner assigned president.
leaguesRouter.post('/', requireAuth, async (req, res) => {
  const { name } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name required' })
  let slug = slugify(name) || 'league'
  if (await prisma.league.findUnique({ where: { slug } })) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`

  const league = await prisma.league.create({
    data: { name, slug, ownerUserId: req.session.userId },
  })
  await cloneSeed(league.id)
  await seedDefaultPermissions(league.id)
  const membership = await prisma.membership.create({
    data: { leagueId: league.id, userId: req.session.userId, isOwner: true, status: 'active' },
  })
  const president = await prisma.role.findFirst({ where: { leagueId: league.id, key: 'president' } })
  if (president)
    await prisma.officerAssignment.create({ data: { leagueId: league.id, membershipId: membership.id, roleId: president.id } })

  res.json({ id: league.id, name: league.name, slug: league.slug })
})

// Leagues I belong to
leaguesRouter.get('/', requireAuth, async (req, res) => {
  const memberships = await prisma.membership.findMany({
    // A super admin picks up a membership in the seed league the first time they
    // open it; the template is not one of "your leagues", so keep it out of this
    // list — it is reachable from the admin console only.
    where: { userId: req.session.userId, status: 'active', league: { isSeed: false } },
    include: { league: true },
  })
  res.json(memberships.map((m) => ({ id: m.league.id, name: m.league.name, slug: m.league.slug, isOwner: m.isOwner })))
})

// Everything below is scoped to a league the caller belongs to
leaguesRouter.get('/:leagueId', requireAuth, loadLeague, async (req, res) => {
  res.json({
    id: req.league.id, name: req.league.name, slug: req.league.slug,
    fyStartMonth: req.league.fyStartMonth, isOwner: req.isOwner,
    myRoles: await myRoles(req.leagueId, req.membership.id),
    myPermissions: await listEditable(req.leagueId, req.membership),
  })
})

// League profile / settings (owner)
const LEAGUE_FIELDS = ['name', 'website', 'contactEmail', 'contactPhone', 'addressLine1', 'city', 'state', 'postalCode', 'timezone']
leaguesRouter.get('/:leagueId/settings', requireAuth, loadLeague, async (req, res) => {
  const l = req.league
  res.json({ ...Object.fromEntries(LEAGUE_FIELDS.map((f) => [f, l[f] ?? ''])), id: l.id, canEdit: req.isOwner })
})
leaguesRouter.patch('/:leagueId', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const data = {}
  for (const f of LEAGUE_FIELDS) if (req.body?.[f] !== undefined) data[f] = req.body[f] || null
  if (data.name !== undefined && !String(data.name || '').trim()) return res.status(400).json({ error: 'name required' })
  if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to update' })
  const l = await prisma.league.update({ where: { id: req.leagueId }, data })
  res.json({ ...Object.fromEntries(LEAGUE_FIELDS.map((f) => [f, l[f] ?? ''])), id: l.id, canEdit: true })
})

leaguesRouter.get('/:leagueId/roles', requireAuth, loadLeague, async (req, res) => {
  res.json(await withLeague(req.leagueId).role.findMany({ orderBy: { id: 'asc' } }))
})

/* ---- Custom roles --------------------------------------------------------
   Roles are referenced by `key` (a loose string) from tasks, email templates,
   calendar items and the permission matrix — there is no foreign key. So the key
   is immutable once created (renaming only changes the display name), and a role
   can only be deleted once nothing points at it. */
const roleKeyFrom = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

async function roleUsage(leagueId, roleKey) {
  const [tasks, templates, calendar, assignments, permissions] = await Promise.all([
    prisma.task.count({ where: { leagueId, roleKey } }),
    prisma.emailTemplate.count({ where: { leagueId, roleKey } }),
    prisma.calendarItem.count({ where: { leagueId, roleKey } }),
    prisma.officerAssignment.count({ where: { leagueId, role: { key: roleKey } } }),
    prisma.categoryPermission.count({ where: { leagueId, roleKey } }),
  ])
  return { tasks, templates, calendar, assignments, permissions,
    total: tasks + templates + calendar + assignments + permissions }
}

leaguesRouter.post('/:leagueId/roles', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })
  let key = roleKeyFrom(name)
  if (!key) return res.status(400).json({ error: 'name must contain letters or numbers' })
  if (await prisma.role.findFirst({ where: { leagueId: req.leagueId, key } }))
    return res.status(409).json({ error: `A role keyed "${key}" already exists.` })

  const role = await prisma.role.create({
    data: { leagueId: req.leagueId, key, name,
      description: String(req.body?.description || '').trim(), isCustom: true },
  })
  res.status(201).json(role)
})

// Display name / description only. The key is what everything else references.
leaguesRouter.patch('/:leagueId/roles/:id', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const role = await prisma.role.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!role) return res.status(404).json({ error: 'not found' })
  const data = {}
  if (req.body?.name !== undefined) {
    if (!String(req.body.name).trim()) return res.status(400).json({ error: 'name required' })
    data.name = String(req.body.name).trim()
  }
  if (req.body?.description !== undefined) data.description = String(req.body.description)
  if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to update' })
  res.json(await prisma.role.update({ where: { id }, data }))
})

leaguesRouter.get('/:leagueId/roles/:id/usage', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const role = await prisma.role.findFirst({ where: { id: parseInt(req.params.id, 10), leagueId: req.leagueId } })
  if (!role) return res.status(404).json({ error: 'not found' })
  res.json({ role, usage: await roleUsage(req.leagueId, role.key) })
})

/* Delete a custom role. Content pointing at it must go somewhere first: pass
   ?reassignTo=<roleKey> to move it, otherwise the request is refused with the
   counts so the owner can decide. Seeded roles are never deletable — the seed
   content assumes they exist. */
leaguesRouter.delete('/:leagueId/roles/:id', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const role = await prisma.role.findFirst({ where: { id, leagueId: req.leagueId } })
  if (!role) return res.status(404).json({ error: 'not found' })
  if (!role.isCustom)
    return res.status(400).json({ error: 'Built-in roles cannot be deleted. Rename it instead.' })

  const usage = await roleUsage(req.leagueId, role.key)
  const reassignTo = String(req.query.reassignTo || req.body?.reassignTo || '').trim()

  if (usage.total && !reassignTo)
    return res.status(409).json({ error: 'That role is still in use.', usage })

  if (reassignTo) {
    const target = await prisma.role.findFirst({ where: { leagueId: req.leagueId, key: reassignTo } })
    if (!target) return res.status(400).json({ error: 'unknown role to reassign to' })
    const where = { leagueId: req.leagueId, roleKey: role.key }
    await prisma.task.updateMany({ where, data: { roleKey: target.key } })
    await prisma.emailTemplate.updateMany({ where, data: { roleKey: target.key } })
    await prisma.calendarItem.updateMany({ where, data: { roleKey: target.key } })
    // permissions are (category, roleKey)-unique, so a merge could collide
    await prisma.categoryPermission.deleteMany({ where })
  }
  await prisma.officerAssignment.deleteMany({ where: { leagueId: req.leagueId, roleId: role.id } })
  await prisma.role.delete({ where: { id } })
  res.json({ ok: true, reassignedTo: reassignTo || null, moved: usage })
})

leaguesRouter.get('/:leagueId/members', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const members = await prisma.membership.findMany({
    where: { leagueId: req.leagueId },
    include: { user: { select: { id: true, email: true, displayName: true, phone: true } }, assignments: { include: { role: true } } },
  })
  res.json(members.map((m) => ({
    membershipId: m.id, isOwner: m.isOwner, status: m.status,
    user: m.user, roles: m.assignments.map((a) => ({ id: a.role.id, key: a.role.key, name: a.role.name })),
  })))
})

/* ---- Archive / restore a member -----------------------------------------
   Deliberately not a delete. OfficerAssignment rows are the record of who held
   which role, and board minutes name people as facilitator, recorder and mover
   of motions — destroying the membership would leave that history unresolvable.
   Archiving flips status to "removed", which loadLeague already treats as no
   access, so it revokes the person immediately while keeping the trail. */
leaguesRouter.delete('/:leagueId/members/:membershipId', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const membershipId = parseInt(req.params.membershipId, 10)
  const target = await prisma.membership.findFirst({
    where: { id: membershipId, leagueId: req.leagueId }, include: { user: { select: { displayName: true } } },
  })
  if (!target) return res.status(404).json({ error: 'not found' })
  if (target.isOwner)
    return res.status(400).json({ error: 'The league owner cannot be removed. Transfer ownership first.' })
  if (target.userId === req.session.userId)
    return res.status(400).json({ error: "You can't remove yourself from the league." })
  if (target.status === 'removed') return res.json({ ok: true, alreadyArchived: true })

  const m = await prisma.membership.update({ where: { id: membershipId }, data: { status: 'removed' } })
  // role assignments are KEPT on purpose — they are the historical record
  const heldRoles = await prisma.officerAssignment.count({ where: { membershipId } })
  res.json({ ok: true, archived: true, membershipId: m.id, rolesRetainedForHistory: heldRoles })
})

leaguesRouter.post('/:leagueId/members/:membershipId/restore', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const membershipId = parseInt(req.params.membershipId, 10)
  const target = await prisma.membership.findFirst({ where: { id: membershipId, leagueId: req.leagueId } })
  if (!target) return res.status(404).json({ error: 'not found' })
  const m = await prisma.membership.update({ where: { id: membershipId }, data: { status: 'active' } })
  res.json({ ok: true, membershipId: m.id, status: m.status })
})

// Edit a member's profile — owner, or the member themselves.
leaguesRouter.patch('/:leagueId/members/:membershipId', requireAuth, loadLeague, async (req, res) => {
  const membershipId = parseInt(req.params.membershipId, 10)
  const target = await prisma.membership.findFirst({ where: { id: membershipId, leagueId: req.leagueId } })
  if (!target) return res.status(404).json({ error: 'not found' })
  if (!req.isOwner && target.userId !== req.session.userId)
    return res.status(403).json({ error: 'not permitted' })

  const { displayName, email, phone } = req.body || {}
  const data = {}
  if (displayName !== undefined) {
    if (!String(displayName).trim()) return res.status(400).json({ error: 'name required' })
    data.displayName = String(displayName).trim()
  }
  if (phone !== undefined) data.phone = String(phone).trim() || null
  if (email !== undefined) {
    const e = String(email).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'invalid email address' })
    const clash = await prisma.user.findFirst({ where: { email: e, NOT: { id: target.userId } } })
    if (clash) return res.status(409).json({ error: 'that email is already in use' })
    data.email = e
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to update' })
  const user = await prisma.user.update({
    where: { id: target.userId }, data,
    select: { id: true, email: true, displayName: true, phone: true },
  })
  res.json({ membershipId, user })
})

/* Email suppression, league-owner view.

   Deliberately EXACT-MATCH ONLY and never a listing: an owner should be able to
   fix "my treasurer says she stopped getting emails", not enumerate or harvest
   every address that ever unsubscribed across the platform. Super admins get the
   full list at /api/admin/suppressions. */
leaguesRouter.get('/:leagueId/suppression', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Enter a full email address to look up.' })
  const row = await prisma.emailSuppression.findUnique({ where: { email } })
  res.json({ email, suppressed: !!row, since: row?.createdAt || null, reason: row?.reason || null })
})

leaguesRouter.delete('/:leagueId/suppression', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'email required' })
  const r = await prisma.emailSuppression.deleteMany({ where: { email } })
  if (r.count) console.log(`[mail] ${email} resubscribed by league ${req.leagueId} owner`)
  res.json({ ok: true, email, restored: r.count > 0 })
})

// Assign / unassign a member to a role (owner)
leaguesRouter.post('/:leagueId/assignments', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const { membershipId, roleKey } = req.body || {}
  const role = await prisma.role.findFirst({ where: { leagueId: req.leagueId, key: roleKey } })
  const member = await prisma.membership.findFirst({ where: { leagueId: req.leagueId, id: membershipId } })
  if (!role || !member) return res.status(400).json({ error: 'unknown role or member' })
  if (member.status === 'removed')
    return res.status(400).json({ error: 'That member has been removed. Restore them before assigning roles.' })
  const created = await prisma.officerAssignment.upsert({
    where: { leagueId_membershipId_roleId: { leagueId: req.leagueId, membershipId, roleId: role.id } },
    update: {}, create: { leagueId: req.leagueId, membershipId, roleId: role.id },
  })
  res.json({ id: created.id })
})

leaguesRouter.delete('/:leagueId/assignments', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const { membershipId, roleKey } = req.body || {}
  const role = await prisma.role.findFirst({ where: { leagueId: req.leagueId, key: roleKey } })
  if (role) await prisma.officerAssignment.deleteMany({ where: { leagueId: req.leagueId, membershipId, roleId: role.id } })
  res.json({ ok: true })
})

// Invites (owner creates; anyone authed accepts by token)
leaguesRouter.post('/:leagueId/invites', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const { email, roleKeys } = req.body || {}
  if (!email) return res.status(400).json({ error: 'email required' })

  // Reject unknown role keys rather than storing them: redemption looks each key
  // up and skips misses, so a typo would silently grant nothing and the owner
  // would never find out until the new officer saw an empty sidebar.
  if ((roleKeys || []).length) {
    const known = await prisma.role.findMany({
      where: { leagueId: req.leagueId, key: { in: roleKeys } }, select: { key: true },
    })
    const missing = roleKeys.filter((k) => !known.some((r) => r.key === k))
    if (missing.length) return res.status(400).json({ error: `unknown role(s): ${missing.join(', ')}` })
  }

  const token = crypto.randomBytes(24).toString('hex')
  const invite = await prisma.invite.create({
    data: {
      leagueId: req.leagueId, email: email.toLowerCase(), roleKeys: roleKeys || [],
      tokenHash: sha256(token), invitedByUserId: req.session.userId,
      expiresAt: new Date(Date.now() + 14 * 864e5),
    },
  })
  // loadLeague doesn't join the user, so fetch the inviter's name for the email.
  const inviter = await prisma.user.findUnique({
    where: { id: req.session.userId }, select: { displayName: true },
  })
  // Look up friendly role names so the email says "Treasurer", not "treasurer".
  const roles = (roleKeys || []).length
    ? await prisma.role.findMany({ where: { leagueId: req.leagueId, key: { in: roleKeys } }, select: { name: true } })
    : []

  const mail = await sendMail({
    to: invite.email,
    ...leagueInvite({
      leagueName: req.league.name,
      inviterName: inviter?.displayName,
      roleNames: roles.map((r) => r.name),
      token,
      expiresAt: invite.expiresAt,
    }),
  })

  // The invite row is the source of truth; a failed send must not undo it or
  // 500 the request. Keep returning acceptUrl so the owner can always copy the
  // link by hand — that is the fallback when mail is misconfigured.
  res.json({
    id: invite.id,
    email: invite.email,
    acceptUrl: `${process.env.APP_URL || process.env.CLIENT_ORIGIN}/invite/accept?token=${token}`,
    emailed: mail.ok,
    emailError: mail.ok ? undefined : mail.error,
  })
})

leaguesRouter.get('/:leagueId/invites', requireAuth, loadLeague, requireOwner, async (req, res) => {
  const invites = await prisma.invite.findMany({ where: { leagueId: req.leagueId }, orderBy: { id: 'desc' } })
  res.json(invites.map((i) => ({ id: i.id, email: i.email, roleKeys: i.roleKeys, status: i.status, expiresAt: i.expiresAt })))
})

/* ============================================================================
   Invite redemption (top-level router at /api/invites)

   An invited officer usually has NO account yet, so everything here except
   /accept must work while signed out. The token in the emailed link is the only
   secret, which is why /preview is rate limited — otherwise it's an oracle for
   guessing tokens.
   ========================================================================== */
export const invitesRouter = Router()

const inviteLimiter = rateLimit({
  ...sharedStore('invite'),
  windowMs: 15 * 60 * 1000, limit: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
})

// Find a usable invite, or explain why it isn't usable.
async function loadInvite(token) {
  if (!token) return { error: 'This invitation link is missing its code.' }
  const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(String(token)) } })
  if (!invite) return { error: 'This invitation link is not valid.' }
  if (invite.status === 'accepted') return { error: 'This invitation has already been used.', invite }
  if (invite.status !== 'pending') return { error: 'This invitation is no longer active.', invite }
  if (invite.expiresAt < new Date()) return { error: 'This invitation has expired. Ask for a new one.', invite }
  return { invite }
}

// Grant membership + roles and burn the invite. Shared by /accept and /register.
async function redeemInvite(invite, userId) {
  const membership = await prisma.membership.upsert({
    where: { leagueId_userId: { leagueId: invite.leagueId, userId } },
    update: { status: 'active' },
    create: { leagueId: invite.leagueId, userId, status: 'active' },
  })
  for (const key of invite.roleKeys || []) {
    const role = await prisma.role.findFirst({ where: { leagueId: invite.leagueId, key } })
    if (role) await prisma.officerAssignment.upsert({
      where: { leagueId_membershipId_roleId: { leagueId: invite.leagueId, membershipId: membership.id, roleId: role.id } },
      update: {}, create: { leagueId: invite.leagueId, membershipId: membership.id, roleId: role.id },
    })
  }
  // A super admin created this league on someone else's behalf and held it in
  // trust; redeeming hands it over. The creating admin keeps their membership so
  // the league is never left without one.
  if (invite.isOwnerInvite) {
    await prisma.league.update({ where: { id: invite.leagueId }, data: { ownerUserId: userId } })
    await prisma.membership.update({ where: { id: membership.id }, data: { isOwner: true } })
    await prisma.membership.updateMany({
      where: { leagueId: invite.leagueId, isOwner: true, NOT: { id: membership.id } },
      data: { isOwner: false },
    })
  }

  await prisma.invite.update({ where: { id: invite.id }, data: { status: 'accepted', acceptedAt: new Date() } })
  return invite.leagueId
}

// What the invitee is being asked to join — shown before they commit to anything.
// Public: they have no account yet.
invitesRouter.get('/preview', inviteLimiter, async (req, res) => {
  const { invite, error } = await loadInvite(req.query.token)
  if (error) return res.status(400).json({ error })

  const [league, inviter, roles, existingUser] = await Promise.all([
    prisma.league.findUnique({ where: { id: invite.leagueId }, select: { name: true } }),
    invite.invitedByUserId
      ? prisma.user.findUnique({ where: { id: invite.invitedByUserId }, select: { displayName: true } })
      : null,
    (invite.roleKeys || []).length
      ? prisma.role.findMany({ where: { leagueId: invite.leagueId, key: { in: invite.roleKeys } }, select: { name: true } })
      : [],
    prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } }),
  ])

  res.json({
    email: invite.email,
    leagueName: league?.name || 'the league',
    inviterName: inviter?.displayName || null,
    roleNames: roles.map((r) => r.name),
    expiresAt: invite.expiresAt,
    // lets the UI open on "Sign in" instead of "Create account"
    hasAccount: !!existingUser,
  })
})

// Already signed in: just redeem it.
invitesRouter.post('/accept', requireAuth, async (req, res) => {
  const { invite, error } = await loadInvite(req.body?.token)
  if (error) return res.status(400).json({ error })
  res.json({ leagueId: await redeemInvite(invite, req.session.userId) })
})

// No account yet: create one and redeem in a single step, then sign them in.
invitesRouter.post('/register', inviteLimiter, async (req, res) => {
  const { token, displayName, password } = req.body || {}
  const { invite, error } = await loadInvite(token)
  if (error) return res.status(400).json({ error })

  if (!displayName || !String(displayName).trim()) return res.status(400).json({ error: 'name required' })
  if (!password || String(password).length < 8)
    return res.status(400).json({ error: 'password must be at least 8 characters' })

  // Default to the invited address, but allow a different one — public
  // registration already exists, so this grants nothing new.
  const email = String(req.body.email || invite.email).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid email address' })
  if (await prisma.user.findUnique({ where: { email } }))
    return res.status(409).json({ error: 'An account with that email already exists — sign in instead.' })

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(String(password), 10),
      displayName: String(displayName).trim(),
    },
  })
  const leagueId = await redeemInvite(invite, user.id)
  req.session.userId = user.id
  res.json({ leagueId, user: { id: user.id, email: user.email, displayName: user.displayName } })
})
