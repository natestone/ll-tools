import React from 'react'

// Field usage panel (list view only).
export default function FieldSummary({ scheduleData }) {
  const { schedule } = scheduleData
  const fields = [...new Set(schedule.map(g => g.field))]

  const fieldStats = {}
  fields.forEach(field => {
    fieldStats[field] = { totalGames: 0, weekdayGames: 0, weekendGames: 0, timeSlotUsage: {} }
  })
  schedule.forEach(game => {
    const fs = fieldStats[game.field]
    fs.totalGames++
    if (game.isWeekend) fs.weekendGames++
    else fs.weekdayGames++
    fs.timeSlotUsage[game.timeSlot] = (fs.timeSlotUsage[game.timeSlot] || 0) + 1
  })

  return (
    <div className="sched-panel">
      <h3>Field Usage</h3>
      <div className="sched-card-grid">
        {Object.keys(fieldStats).map(field => {
          const fs = fieldStats[field]
          const timeSlots = Object.entries(fs.timeSlotUsage)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([time, count]) => `${time} (${count} games)`)
            .join(', ')
          return (
            <div className="sched-field-card" key={field}>
              <div className="sched-field-name">{field}</div>
              <div className="sched-field-info"><strong>Total Games:</strong> {fs.totalGames}</div>
              <div className="sched-field-info"><strong>Weekday Games:</strong> {fs.weekdayGames}</div>
              <div className="sched-field-info"><strong>Weekend Games:</strong> {fs.weekendGames}</div>
              <div className="sched-field-info"><strong>Time Slots:</strong> {timeSlots}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
