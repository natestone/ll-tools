import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

// Tenant-scoping seam: every tenant query goes through a leagueId-bound delegate
// so a controller can never accidentally read/write across leagues.
const TENANT_MODELS = [
  'membership', 'role', 'officerAssignment', 'emailTemplate', 'agendaTemplate',
  'calendarItem', 'task', 'policyDocument', 'referenceDoc', 'invite', 'season',
]

export function withLeague(leagueId) {
  if (!Number.isInteger(leagueId)) throw new Error('withLeague requires an integer leagueId')
  const s = {}
  for (const m of TENANT_MODELS) {
    s[m] = {
      findMany: (a = {}) => prisma[m].findMany({ ...a, where: { ...a.where, leagueId } }),
      findFirst: (a = {}) => prisma[m].findFirst({ ...a, where: { ...a.where, leagueId } }),
      count: (a = {}) => prisma[m].count({ ...a, where: { ...a.where, leagueId } }),
      create: (a) => prisma[m].create({ ...a, data: { ...a.data, leagueId } }),
      createMany: (a) => prisma[m].createMany({ ...a, data: a.data.map((d) => ({ ...d, leagueId })) }),
      // update/delete are scoped via updateMany/deleteMany so a stray id from another
      // league simply matches nothing.
      updateMany: (a = {}) => prisma[m].updateMany({ ...a, where: { ...a.where, leagueId } }),
      deleteMany: (a = {}) => prisma[m].deleteMany({ ...a, where: { ...a.where, leagueId } }),
    }
  }
  return s
}
