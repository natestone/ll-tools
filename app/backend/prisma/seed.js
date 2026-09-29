// Bootstrap: load seed/gngrll/ into the SEED ORGANIZATION.
//
// The seed organization is an ordinary League row carrying isSeed = true. It has
// no members, is reachable only by super admins, and is the template every new
// organization is cloned from. Editing it in the app is the normal way to change
// what future leagues receive — this script only exists to stand it up on a fresh
// install, or to reset it back to what is committed on disk.
//
// Idempotent: wipes the seed league's content and reloads it. Other leagues are
// never touched.
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()
const SEED = process.env.SEED_DIR || '/mnt/hgfs/development/gngrll/ll-manager/seed/gngrll'
const SEED_SLUG = '__seed__'
const SEED_NAME = 'Seed Organization'
// Tasks are season-scoped; the seed league holds one notional season that clone
// maps onto whatever season the new league is starting.
const SEED_SEASON = 2000

function parseFrontMatter(txt) {
  const m = txt.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: txt.trim() }
  const fm = {}
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z0-9_]+):\s?(.*)$/)
    if (mm) fm[mm[1]] = mm[2].trim()
  }
  return { fm, body: m[2].trim() }
}

const readDir = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.md')) : [])
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [])
const intOrNull = (v) => (v === undefined || v === '' || v === null || Number.isNaN(Number(v)) ? null : parseInt(v, 10))

/** The seed league, created on first run. Owned by the first super admin if one
 *  exists — ownerUserId is required, and nobody should "own" the template. */
async function ensureSeedLeague() {
  const existing = await prisma.league.findUnique({ where: { slug: SEED_SLUG } })
  if (existing) {
    if (!existing.isSeed) await prisma.league.update({ where: { id: existing.id }, data: { isSeed: true } })
    return existing
  }
  const owner = await prisma.user.findFirst({ where: { isSuperAdmin: true }, orderBy: { id: 'asc' } })
        || await prisma.user.findFirst({ orderBy: { id: 'asc' } })
  if (!owner) throw new Error('No users exist yet — create an account before seeding.')
  return prisma.league.create({
    data: {
      name: SEED_NAME, slug: SEED_SLUG, ownerUserId: owner.id,
      isSeed: true, activeSeasonYear: SEED_SEASON,
    },
  })
}

async function main() {
  console.log('Seeding the Seed Organization from', SEED)
  const league = await ensureSeedLeague()
  const leagueId = league.id

  // wipe this league's content only
  await prisma.$transaction([
    prisma.officerAssignment.deleteMany({ where: { leagueId } }),
    prisma.role.deleteMany({ where: { leagueId } }),
    prisma.emailTemplate.deleteMany({ where: { leagueId } }),
    prisma.agendaTemplate.deleteMany({ where: { leagueId } }),
    prisma.calendarItem.deleteMany({ where: { leagueId } }),
    prisma.task.deleteMany({ where: { leagueId } }),
    prisma.policyDocument.deleteMany({ where: { leagueId } }),
    prisma.referenceDoc.deleteMany({ where: { leagueId } }),
  ])

  const roles = readJson(path.join(SEED, 'roles.json'))
  if (roles.length) await prisma.role.createMany({
    data: roles.map((r) => ({ leagueId, key: r.key, name: r.name, description: r.description || '' })),
  })

  const etDir = path.join(SEED, 'email-templates')
  const et = readDir(etDir).map((f) => {
    const { fm, body } = parseFrontMatter(fs.readFileSync(path.join(etDir, f), 'utf8'))
    return {
      leagueId,
      roleKey: fm.roleKey || 'president',
      key: f.replace(/\.md$/, ''),
      name: (fm.subject || f.replace(/\.md$/, '')).slice(0, 250),
      subject: fm.subject || f.replace(/\.md$/, ''),
      bodyMd: body,
      category: fm.category || f.split('__')[0],
      weekOfFY: intOrNull(fm.weekOfFY),
    }
  })
  if (et.length) await prisma.emailTemplate.createMany({ data: et })

  const agDir = path.join(SEED, 'agenda-templates')
  for (const f of readDir(agDir)) {
    const { fm, body } = parseFrontMatter(fs.readFileSync(path.join(agDir, f), 'utf8'))
    await prisma.agendaTemplate.create({
      data: {
        leagueId, slug: f.replace(/\.md$/, ''), title: fm.title || f.replace(/\.md$/, ''),
        phase: fm.phase || null, weekOfFY: intOrNull(fm.weekOfFY), bodyMd: body,
      },
    })
  }

  const polDir = path.join(SEED, 'policies')
  for (const f of readDir(polDir)) {
    const { fm, body } = parseFrontMatter(fs.readFileSync(path.join(polDir, f), 'utf8'))
    await prisma.policyDocument.create({
      data: { leagueId, slug: fm.slug || f.replace(/\.md$/, ''), title: fm.title || f.replace(/\.md$/, ''), bodyMd: body },
    })
  }

  const refDir = path.join(SEED, 'reference')
  for (const f of readDir(refDir)) {
    const { fm, body } = parseFrontMatter(fs.readFileSync(path.join(refDir, f), 'utf8'))
    await prisma.referenceDoc.create({
      data: { leagueId, slug: f.replace(/\.md$/, ''), title: fm.title || f.replace(/\.md$/, ''), bodyMd: body },
    })
  }

  const cal = readJson(path.join(SEED, 'calendar.json'))
  if (cal.length) await prisma.calendarItem.createMany({
    data: cal.map((c) => ({
      leagueId, roleKey: c.roleKey, weekOfFY: c.weekOfFY ?? 0, kind: c.kind || 'reminder',
      title: (c.title || '').slice(0, 2000), description: c.description || '',
    })),
  })

  const tasks = readJson(path.join(SEED, 'tasks.json'))
  if (tasks.length) await prisma.task.createMany({
    data: tasks.map((t) => ({
      leagueId, seasonYear: SEED_SEASON, roleKey: t.roleKey, dueWeekOfFY: t.dueWeekOfFY ?? null,
      title: (t.title || '').slice(0, 2000), description: t.description || '',
      details: t.details ?? null, steps: t.steps ?? null, links: t.links ?? null, stepsDone: [],
    })),
  })

  const counts = {
    roles: await prisma.role.count({ where: { leagueId } }),
    emailTemplates: await prisma.emailTemplate.count({ where: { leagueId } }),
    agendaTemplates: await prisma.agendaTemplate.count({ where: { leagueId } }),
    calendarItems: await prisma.calendarItem.count({ where: { leagueId } }),
    tasks: await prisma.task.count({ where: { leagueId } }),
    policies: await prisma.policyDocument.count({ where: { leagueId } }),
    references: await prisma.referenceDoc.count({ where: { leagueId } }),
  }
  console.log(`Seed Organization (league ${leagueId}) loaded:`, counts)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
