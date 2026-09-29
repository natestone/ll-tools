// One-off: stamp existing tasks with the current season, create the Season rows,
// and set each league's activeSeasonYear.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const currentSeasonYear = (d = new Date()) => (d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1)

async function main() {
  const year = currentSeasonYear()
  const leagues = await prisma.league.findMany()
  for (const l of leagues) {
    const stamped = await prisma.task.updateMany({
      where: { leagueId: l.id, seasonYear: null }, data: { seasonYear: year },
    })
    await prisma.task.updateMany({
      where: { leagueId: l.id, archivedSteps: { equals: null } }, data: { archivedSteps: [] },
    }).catch(() => {})
    const exists = await prisma.season.findFirst({ where: { leagueId: l.id, seasonYear: year } })
    if (!exists) {
      await prisma.season.create({
        data: { leagueId: l.id, seasonYear: year, fyStart: new Date(year, 9, 1), fyEnd: new Date(year + 1, 8, 30) },
      })
    }
    await prisma.league.update({ where: { id: l.id }, data: { activeSeasonYear: year } })
    console.log(`league ${l.id} "${l.name}": ${stamped.count} tasks -> season ${year}`)
  }
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
