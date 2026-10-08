import { prisma } from './prisma.js'
import { currentSeasonYear } from './fyweeks.js'

export const SEED_SLUG = '__seed__'

/** The one league flagged isSeed — the template new organizations are cloned from. */
export async function getSeedLeague() {
  return prisma.league.findFirst({ where: { isSeed: true }, orderBy: { id: 'asc' } })
}

/* ============================================================================
   Clone the Seed Organization into a new league.

   The template used to live in separate Default* tables loaded from JSON. It is
   now an ordinary (member-less) league, so a super admin edits it with the normal
   app UI and every future organization picks the change up.

   Copied: roles, email templates, agenda templates, calendar items, tasks,
   policies, references — each stamped with seededFromId so "reset to default"
   can find the row it came from.

   NOT copied: memberships, invites, board meetings, scheduler state, seasons, and
   per-season task progress. Those belong to a real league's operation, not to a
   template.
   ========================================================================== */
export async function cloneSeed(leagueId, seasonYear = currentSeasonYear()) {
  const seed = await getSeedLeague()
  if (!seed) throw new Error('No seed organization exists — run `npm run seed` to create it.')
  if (seed.id === leagueId) throw new Error('Refusing to clone the seed organization into itself.')

  const from = { leagueId: seed.id }
  const [roles, emails, agendas, cals, tasks, policies, refs] = await Promise.all([
    prisma.role.findMany({ where: from, orderBy: { id: 'asc' } }),
    prisma.emailTemplate.findMany({ where: from, orderBy: { id: 'asc' } }),
    prisma.agendaTemplate.findMany({ where: from, orderBy: { id: 'asc' } }),
    prisma.calendarItem.findMany({ where: from, orderBy: { id: 'asc' } }),
    // the seed holds its tasks in one notional season; they land in the new
    // league's starting season
    prisma.task.findMany({ where: { ...from, archivedAt: null }, orderBy: { id: 'asc' } }),
    prisma.policyDocument.findMany({ where: from, orderBy: { id: 'asc' } }),
    prisma.referenceDoc.findMany({ where: from, orderBy: { id: 'asc' } }),
  ])

  if (roles.length) await prisma.role.createMany({
    data: roles.map((r) => ({ leagueId, key: r.key, name: r.name, description: r.description })),
  })
  if (emails.length) await prisma.emailTemplate.createMany({
    data: emails.map((e) => ({
      leagueId, roleKey: e.roleKey, key: e.key, name: e.name, subject: e.subject,
      bodyMd: e.bodyMd, category: e.category, weekOfFY: e.weekOfFY, seededFromId: e.id,
    })),
  })
  for (const a of agendas)
    await prisma.agendaTemplate.create({
      data: { leagueId, slug: a.slug, title: a.title, phase: a.phase, weekOfFY: a.weekOfFY, bodyMd: a.bodyMd, seededFromId: a.id },
    })
  if (cals.length) await prisma.calendarItem.createMany({
    data: cals.map((c) => ({
      leagueId, roleKey: c.roleKey, weekOfFY: c.weekOfFY, kind: c.kind,
      title: c.title, description: c.description, dateOverride: c.dateOverride, seededFromId: c.id,
    })),
  })
  if (tasks.length) await prisma.task.createMany({
    data: tasks.map((t) => ({
      leagueId, seasonYear, roleKey: t.roleKey, dueWeekOfFY: t.dueWeekOfFY,
      title: t.title, details: t.details,
      steps: t.steps ?? [], links: t.links ?? [],
      // progress is per-league, never inherited from the template
      status: 'open', stepsDone: [], seededFromId: t.id,
    })),
  })
  for (const p of policies)
    await prisma.policyDocument.create({ data: { leagueId, slug: p.slug, title: p.title, bodyMd: p.bodyMd, seededFromId: p.id } })
  for (const r of refs)
    await prisma.referenceDoc.create({ data: { leagueId, slug: r.slug, title: r.title, bodyMd: r.bodyMd, seededFromId: r.id } })

  // Tasks are season-scoped, so the league needs a matching Season row and a
  // pointer at it — otherwise every task is invisible (seasonYear filter misses).
  await prisma.season.upsert({
    where: { leagueId_seasonYear: { leagueId, seasonYear } },
    update: {},
    create: { leagueId, seasonYear, fyStart: new Date(seasonYear, 9, 1), fyEnd: new Date(seasonYear + 1, 8, 30) },
  })
  await prisma.league.update({ where: { id: leagueId }, data: { activeSeasonYear: seasonYear } })

  return {
    fromLeagueId: seed.id, seasonYear,
    roles: roles.length, emails: emails.length, agendas: agendas.length,
    cals: cals.length, tasks: tasks.length, policies: policies.length, refs: refs.length,
  }
}
