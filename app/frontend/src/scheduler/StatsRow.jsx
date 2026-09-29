import React from 'react'

// The 5 stat cards: Teams, Divisions, Fields, Total Games, Weeks.
export default function StatsRow({ scheduleData }) {
  const { schedule, teams, divisions, weeks } = scheduleData
  const totalGames = schedule.length
  const fields = [...new Set(schedule.map(g => g.field))]

  const cards = [
    { n: teams.length, label: 'Teams' },
    { n: divisions.length, label: 'Divisions' },
    { n: fields.length, label: 'Fields' },
    { n: totalGames, label: 'Total Games' },
    { n: weeks, label: 'Weeks' },
  ]

  return (
    <div className="sched-stats">
      {cards.map((c) => (
        <div className="sched-stat-card" key={c.label}>
          <div className="sched-stat-number">{c.n}</div>
          <div className="sched-stat-label">{c.label}</div>
        </div>
      ))}
    </div>
  )
}
