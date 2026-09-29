// CSV export, ported from downloadSchedule (~L2979). Columns:
// Date, Day, Time, Home Team, Away Team, Field, Division, Game Type,
// Preference Violation. Filename baseball_schedule.csv.
export function downloadScheduleCsv(currentSchedule) {
  if (!currentSchedule || !currentSchedule.schedule || currentSchedule.schedule.length === 0) return

  let csv = 'Date,Day,Time,Home Team,Away Team,Field,Division,Game Type,Preference Violation\n'

  currentSchedule.schedule.forEach(game => {
    const dateStr = game.date.toLocaleDateString('en-US')
    const dayStr = game.date.toLocaleDateString('en-US', { weekday: 'long' })
    const gameType = game.isWeekend ? 'Weekend' : 'Weekday'
    const prefViolation = game.violatesPreference ? 'Yes' : 'No'
    const division = currentSchedule.teamStats[game.homeTeam].division

    csv += `"${dateStr}","${dayStr}","${game.timeSlot}","${game.homeTeam}","${game.awayTeam}","${game.field}","${division}","${gameType}","${prefViolation}"\n`
  })

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'baseball_schedule.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}
