import { prisma } from '../lib/prisma.js'

export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'not authenticated' })
  next()
}

// Resolves :leagueId, loads the caller's membership, and attaches league context.
// 404 (not 403) on a membership miss so league existence isn't leaked.
export async function loadLeague(req, res, next) {
  const leagueId = parseInt(req.params.leagueId, 10)
  if (!Number.isInteger(leagueId)) return res.status(400).json({ error: 'bad leagueId' })
  let membership = await prisma.membership.findFirst({
    where: { leagueId, userId: req.session.userId, status: 'active' },
    include: { league: true },
  })
  if (!membership) {
    // A super admin can open the SEED organization — the template has no members,
    // and editing it is the whole point of the admin console. Deliberately scoped
    // to the seed league: this is NOT a back door into real leagues' data.
    //
    // We grant a real Membership row rather than faking one in memory: plenty of
    // downstream code queries by membership.id (officer assignments, permissions),
    // and a synthetic row with a null id crashes those queries.
    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (league?.isSeed && req.session?.userId) {
      const me = await prisma.user.findUnique({
        where: { id: req.session.userId }, select: { isSuperAdmin: true },
      })
      if (me?.isSuperAdmin) {
        membership = await prisma.membership.upsert({
          where: { leagueId_userId: { leagueId, userId: req.session.userId } },
          update: { status: 'active', isOwner: true },
          create: { leagueId, userId: req.session.userId, status: 'active', isOwner: true },
          include: { league: true },
        })
        req.isSeedAdmin = true
      }
    }
    if (!membership) return res.status(404).json({ error: 'not found' })
  }

  req.leagueId = leagueId
  req.membership = membership
  req.league = membership.league
  req.isOwner = membership.isOwner
  next()
}

export function requireOwner(req, res, next) {
  if (!req.isOwner) return res.status(403).json({ error: 'owner only' })
  next()
}

// Platform operator. Checked against the database every request rather than
// trusted from the session, so revoking the flag takes effect immediately
// instead of when that person happens to log out.
export async function requireSuperAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'not authenticated' })
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId }, select: { isSuperAdmin: true },
  })
  // 404, not 403: don't confirm that an admin surface exists to people probing for it.
  if (!user?.isSuperAdmin) return res.status(404).json({ error: 'not found' })
  req.isSuperAdmin = true
  next()
}
