// One-time backfill: apply enriched task details/steps/links and template keys
// to the EXISTING league 1 (created before these fields existed). Natural-key
// matching (roleKey+title for tasks; roleKey+subject for templates).
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()
const SEED = process.env.SEED_DIR || '/mnt/hgfs/development/gngrll/ll-manager/seed/gngrll'
const LEAGUE = 1

function parseFrontMatter(txt) {
  const m = txt.match(/^---\s*\n([\s\S]*?)\n---/)
  const d = {}
  if (m) for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z0-9_]+):\s?(.*)$/); if (mm) d[mm[1]] = mm[2].trim()
  }
  return d
}

async function main() {
  // ---- tasks ----
  const tasks = JSON.parse(fs.readFileSync(path.join(SEED, 'tasks.json'), 'utf8'))
  let tUpd = 0
  for (const t of tasks) {
    const r = await prisma.task.updateMany({
      where: { leagueId: LEAGUE, roleKey: t.roleKey, title: t.title },
      data: { details: t.details ?? null, steps: t.steps ?? null, links: t.links ?? null },
    })
    tUpd += r.count
  }
  // init stepsDone [] where still null
  await prisma.$executeRawUnsafe(`UPDATE Task SET stepsDone = '[]' WHERE leagueId = ${LEAGUE} AND stepsDone IS NULL`)

  // ---- email template keys ----
  const etDir = path.join(SEED, 'email-templates')
  let kUpd = 0, ambiguous = []
  for (const f of fs.readdirSync(etDir).filter((x) => x.endsWith('.md'))) {
    const key = f.replace(/\.md$/, '')
    const fm = parseFrontMatter(fs.readFileSync(path.join(etDir, f), 'utf8'))
    const roleKey = fm.roleKey || 'president'
    const subject = fm.subject || key
    let rows = await prisma.emailTemplate.findMany({ where: { leagueId: LEAGUE, roleKey, subject, key: null } })
    if (rows.length !== 1) rows = await prisma.emailTemplate.findMany({ where: { leagueId: LEAGUE, roleKey, subject, category: fm.category, key: null } })
    if (rows.length === 1) { await prisma.emailTemplate.update({ where: { id: rows[0].id }, data: { key } }); kUpd++ }
    else ambiguous.push({ key, matched: rows.length })
  }

  console.log(`tasks updated: ${tUpd}/${tasks.length} | template keys set: ${kUpd} | ambiguous templates: ${ambiguous.length}`)
  if (ambiguous.length) console.log('  ambiguous:', ambiguous.slice(0, 10))
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
