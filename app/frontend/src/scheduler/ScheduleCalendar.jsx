import React from 'react'
import StatsRow from './StatsRow.jsx'
import TeamSummary from './TeamSummary.jsx'

const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Calendar view: month grids, up to 3 games/day + "+N more".
export default function ScheduleCalendar({ scheduleData }) {
  const { schedule, teamStats } = scheduleData

  if (!schedule || schedule.length === 0) {
    return <div className="sched-error">No games scheduled.</div>
  }

  const totalGames = schedule.length

  // Group games by month
  const gamesByMonth = new Map()
  schedule.forEach(game => {
    const monthYear = game.date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    if (!gamesByMonth.has(monthYear)) gamesByMonth.set(monthYear, [])
    gamesByMonth.get(monthYear).push(game)
  })

  const sortedMonths = Array.from(gamesByMonth.keys()).sort((a, b) => new Date(a) - new Date(b))

  return (
    <div>
      <StatsRow scheduleData={scheduleData} />

      <div className="sched-success">
        <strong>🎉 Schedule Generated!</strong><br />
        Filled {totalGames} games across the available fields and time slots.<br />
        Day-off preferences were respected — matchups that would have landed on a team's day off were skipped.
      </div>

      <div className="sched-calendar-container">
        {sortedMonths.map(monthYear => {
          const monthGames = gamesByMonth.get(monthYear)
          const firstGame = monthGames[0]
          const year = firstGame.date.getFullYear()
          const month = firstGame.date.getMonth()
          const firstDayOfMonth = new Date(year, month, 1)
          const lastDayOfMonth = new Date(year, month + 1, 0)
          const startPadding = firstDayOfMonth.getDay()
          const endPadding = 6 - lastDayOfMonth.getDay()

          const cells = []
          // Day headers
          dayNamesShort.forEach(day => {
            cells.push(<div className="sched-cal-header-cell" key={'h-' + day}>{day}</div>)
          })
          // Leading padding
          for (let i = 0; i < startPadding; i++) {
            cells.push(<div className="sched-cal-cell sched-cal-cell-empty" key={'lp-' + i} />)
          }
          // Days
          for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
            const currentDate = new Date(year, month, day)
            const dateStr = currentDate.toISOString().split('T')[0]
            const dayGames = monthGames.filter(g => g.date.toISOString().split('T')[0] === dateStr)
            const maxGamesToShow = 3
            const gamesToShow = dayGames.slice(0, maxGamesToShow)
            cells.push(
              <div className="sched-cal-cell" key={'d-' + day}>
                <div className="sched-cal-date">{day}</div>
                {dayGames.length > 0 && (
                  <div className="sched-cal-games">
                    {gamesToShow.map((game, gi) => {
                      const division = teamStats[game.homeTeam].division
                      const violationMark = game.violatesPreference ? '⚠️ ' : ''
                      return (
                        <div
                          className={'sched-cal-game' + (game.isWeekend ? ' weekend' : '')}
                          key={gi}
                          title={`${division}: ${game.timeSlot} - ${game.homeTeam} vs ${game.awayTeam} at ${game.field}`}
                        >
                          {violationMark}<span className="sched-cal-game-time">{game.timeSlot}</span> {game.homeTeam} vs {game.awayTeam}
                        </div>
                      )
                    })}
                    {dayGames.length > maxGamesToShow && (
                      <div className="sched-cal-more">+{dayGames.length - maxGamesToShow} more</div>
                    )}
                  </div>
                )}
              </div>
            )
          }
          // Trailing padding
          for (let i = 0; i < endPadding; i++) {
            cells.push(<div className="sched-cal-cell sched-cal-cell-empty" key={'tp-' + i} />)
          }

          return (
            <div className="sched-cal-month" key={monthYear}>
              <div className="sched-cal-month-header">{monthYear}</div>
              {/* plain wrapper on desktop; becomes the horizontal scroll box on phones */}
              <div className="sched-cal-scroll">
                <div className="sched-cal-grid">{cells}</div>
              </div>
            </div>
          )
        })}
      </div>

      <TeamSummary scheduleData={scheduleData} />
    </div>
  )
}
