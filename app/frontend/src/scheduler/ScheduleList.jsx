import React from 'react'
import { getSeasonWeekInfo, getWeekStartDate, formatDate } from './engine.js'
import StatsRow from './StatsRow.jsx'
import FieldSummary from './FieldSummary.jsx'
import TeamSummary from './TeamSummary.jsx'

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6
}

// List view: group by week (via getSeasonWeekInfo), then by day, with game cards.
export default function ScheduleList({ scheduleData }) {
  const { schedule, teamStats } = scheduleData
  const totalGames = schedule.length

  const seasonStart = scheduleData.seasonStart
    ? new Date(scheduleData.seasonStart)
    : (schedule.length ? getWeekStartDate(schedule[0].date) : new Date())

  // Group games by week -> day
  const gamesByWeek = new Map()
  const weekBounds = new Map()

  schedule.forEach(game => {
    const { weekIndex, weekStart, weekEnd } = getSeasonWeekInfo(game.date, seasonStart)
    if (!gamesByWeek.has(weekIndex)) {
      gamesByWeek.set(weekIndex, new Map())
      weekBounds.set(weekIndex, { weekStart, weekEnd })
    }
    const dayKey = new Date(game.date).toDateString()
    const daysMap = gamesByWeek.get(weekIndex)
    if (!daysMap.has(dayKey)) daysMap.set(dayKey, [])
    daysMap.get(dayKey).push(game)
  })

  const sortedWeeks = Array.from(gamesByWeek.keys()).sort((a, b) => a - b)

  return (
    <div>
      <StatsRow scheduleData={scheduleData} />

      <div className="sched-success">
        <strong>🎉 Schedule Generated!</strong><br />
        Filled {totalGames} games across the available fields and time slots.<br />
        Day-off preferences were respected — matchups that would have landed on a team's day off were skipped.
      </div>

      {sortedWeeks.map((weekIndex, index) => {
        const daysMap = gamesByWeek.get(weekIndex)
        const { weekStart, weekEnd } = weekBounds.get(weekIndex)
        const weekGameCount = Array.from(daysMap.values()).reduce((sum, games) => sum + games.length, 0)
        const sortedDays = Array.from(daysMap.keys()).sort((a, b) => new Date(a) - new Date(b))

        return (
          <div className="sched-week-section" key={weekIndex}>
            <div className="sched-week-header">
              Week {index + 1}: {weekStart.toLocaleDateString()} - {weekEnd.toLocaleDateString()} ({weekGameCount} games)
            </div>
            {sortedDays.map(dayKey => {
              const dayGames = daysMap.get(dayKey).slice().sort((a, b) => (a.timeSlot || '').localeCompare(b.timeSlot || ''))
              const dayDate = dayGames[0].date
              const isWeekendDay = isWeekend(new Date(dayDate))
              const icon = isWeekendDay ? '🏟' : '📚'
              return (
                <div className="sched-day-group" key={dayKey}>
                  <div className="sched-day-header">{icon} {formatDate(dayDate)} - {dayGames.length} games</div>
                  <div className="sched-games-grid">
                    {dayGames.map((game, gi) => {
                      const division = teamStats[game.homeTeam].division
                      return (
                        <div className="sched-game" key={gi}>
                          <div className="sched-game-time">🕐 {game.timeSlot}</div>
                          <span className="sched-home-team">{game.homeTeam}</span> vs <span className="sched-away-team">{game.awayTeam}</span><br />
                          Field: <span className="sched-field-tag">{game.field}</span><br />
                          <span className="sched-division-name">{division} Division</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      <FieldSummary scheduleData={scheduleData} />
      <TeamSummary scheduleData={scheduleData} showIncompleteNote />
    </div>
  )
}
