import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, loadLeague, requireOwner } from '../middleware/auth.js'
import { LEAGUE_CATEGORIES, ROLE_SCOPED_CATEGORIES } from '../lib/permissions.js'

export const permissionsRouter = Router({ mergeParams: true })
permissionsRouter.use(requireAuth, loadLeague, requireOwner)

// The matrix: categories + roles + current grants (owner-only view/edit).
permissionsRouter.get('/', async (req, res) => {
  const roles = await prisma.role.findMany({ where: { leagueId: req.leagueId }, orderBy: { id: 'asc' } })
  const grants = await prisma.categoryPermission.findMany({ where: { leagueId: req.leagueId } })
  const byCategory = {}
  for (const c of LEAGUE_CATEGORIES) byCategory[c] = grants.filter((g) => g.category === c).map((g) => g.roleKey)
  res.json({
    roles: roles.map((r) => ({ key: r.key, name: r.name })),
    leagueCategories: LEAGUE_CATEGORIES,
    roleScopedCategories: ROLE_SCOPED_CATEGORIES, // informational: editable by own-role holders
    grants: byCategory,
  })
})

// Replace the granted roles for a single league-wide category.
permissionsRouter.put('/', async (req, res) => {
  const { category, roleKeys } = req.body || {}
  if (!LEAGUE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'bad category' })
  const valid = new Set((await prisma.role.findMany({ where: { leagueId: req.leagueId } })).map((r) => r.key))
  const keys = [...new Set((roleKeys || []).filter((k) => valid.has(k)))]
  await prisma.$transaction([
    prisma.categoryPermission.deleteMany({ where: { leagueId: req.leagueId, category } }),
    prisma.categoryPermission.createMany({
      data: keys.map((roleKey) => ({ leagueId: req.leagueId, category, roleKey })), skipDuplicates: true,
    }),
  ])
  res.json({ ok: true, category, roleKeys: keys })
})
