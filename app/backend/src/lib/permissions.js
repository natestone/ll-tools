import { prisma } from './prisma.js'

// Categories controlled by the permission matrix (league-wide documents).
export const LEAGUE_CATEGORIES = ['policies', 'references', 'agenda_templates', 'meetings']
// Categories that are role-scoped: a member may always edit items belonging to
// a role they hold (their own tasks / email templates / calendar). Shown in the
// matrix as informational ("own role"), plus optional cross-role grants.
export const ROLE_SCOPED_CATEGORIES = ['tasks', 'email_templates', 'calendar']
export const ALL_CATEGORIES = [...ROLE_SCOPED_CATEGORIES, ...LEAGUE_CATEGORIES]

// Default editors seeded on league creation.
export const DEFAULT_EDITORS = {
  policies: ['president', 'vp_baseball', 'vp_softball', 'secretary'],
  references: ['president', 'vp_baseball', 'vp_softball', 'secretary'],
  agenda_templates: ['president', 'vp_baseball', 'vp_softball', 'secretary'],
  meetings: ['president', 'vp_baseball', 'vp_softball', 'secretary'],
}

export async function seedDefaultPermissions(leagueId) {
  const rows = []
  for (const [category, roles] of Object.entries(DEFAULT_EDITORS))
    for (const roleKey of roles) rows.push({ leagueId, category, roleKey })
  if (rows.length) await prisma.categoryPermission.createMany({ data: rows, skipDuplicates: true })
}

async function myRoleKeys(leagueId, membershipId) {
  const a = await prisma.officerAssignment.findMany({
    where: { leagueId, membershipId }, include: { role: true },
  })
  return a.map((x) => x.role.key)
}

async function grantedRoleKeys(leagueId, category) {
  const rows = await prisma.categoryPermission.findMany({ where: { leagueId, category } })
  return rows.map((r) => r.roleKey)
}

// Can this membership edit `category`? For role-scoped categories, targetRoleKey
// is the roleKey of the specific item (self-scope). Owner may edit everything.
export async function canEditCategory(leagueId, membership, category, targetRoleKey = null) {
  if (membership.isOwner) return true
  const mine = await myRoleKeys(leagueId, membership.id)
  const granted = await grantedRoleKeys(leagueId, category)
  const hasGrant = mine.some((k) => granted.includes(k))
  if (ROLE_SCOPED_CATEGORIES.includes(category)) {
    const selfScope = targetRoleKey != null && mine.includes(targetRoleKey)
    return selfScope || hasGrant
  }
  return hasGrant
}

// Categories the caller can edit at all (for the frontend to gate UI).
// Role-scoped categories are always listed (they can edit their own items).
export async function listEditable(leagueId, membership) {
  if (membership.isOwner) return [...ALL_CATEGORIES]
  const mine = await myRoleKeys(leagueId, membership.id)
  const out = [...ROLE_SCOPED_CATEGORIES]
  for (const category of LEAGUE_CATEGORIES) {
    const granted = await grantedRoleKeys(leagueId, category)
    if (mine.some((k) => granted.includes(k))) out.push(category)
  }
  return out
}
