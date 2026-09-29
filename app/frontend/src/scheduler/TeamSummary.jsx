import React, { useState } from 'react'

const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Shared team-statistics grid used by both list and calendar views.
// `showIncompleteNote` adds the "Round-robin incomplete" note (list view only).
export default function TeamSummary({ scheduleData, showIncompleteNote }) {
  const { schedule, teamStats, teams } = scheduleData

  return (
    <div className="sched-panel">
      <h3>Team Statistics</h3>
      <div className="sched-card-grid">
        {teams.map(team => (
          <TeamCard
            key={team}
            team={team}
            stats={teamStats[team]}
            teamStats={teamStats}
            teams={teams}
            schedule={schedule}
            showIncompleteNote={showIncompleteNote}
          />
        ))}
      </div>
    </div>
  )
}

function TeamCard({ team, stats, teamStats, teams, schedule, showIncompleteNote }) {
  const [open, setOpen] = useState(false)

  const divisionTeams = teams.filter(t => teamStats[t].division === stats.division)
  const playedAllOpponents = stats.opponents.size === divisionTeams.length - 1

  const playDays = []
  for (let i = 0; i < 7; i++) {
    if (!stats.daysOff.includes(i)) playDays.push(i)
  }
  const playDaysStr = playDays.length === 7
    ? 'Any day'
    : (playDays.length > 0 ? playDays.map(d => dayNamesShort[d]).join(', ') : 'None')

  const opponentCounts = {}
  schedule.forEach(game => {
    if (game.homeTeam === team) {
      opponentCounts[game.awayTeam] = (opponentCounts[game.awayTeam] || 0) + 1
    } else if (game.awayTeam === team) {
      opponentCounts[game.homeTeam] = (opponentCounts[game.homeTeam] || 0) + 1
    }
  })
  const sortedOpponents = Object.entries(opponentCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  return (
    <div className="sched-team-card">
      <div className="sched-team-name">{team} {playedAllOpponents ? '✅' : '⚠️'}</div>
      <div className="sched-team-info"><strong>Division:</strong> {stats.division}</div>
      <div className="sched-team-info sched-team-info-split">
        <span>Total: {stats.totalGames}</span>
        <span>Home: {stats.homeGames}</span>
        <span>Away: {stats.awayGames}</span>
      </div>
      <div className="sched-team-info sched-team-info-split">
        <span>Weekday: {stats.weekdayGames}</span>
        <span>Weekend: {stats.weekendGames}</span>
        <span>Opponents: {stats.opponents.size}</span>
      </div>
      <div className="sched-team-info"><strong>Home Field:</strong> {stats.homeField || 'None'}</div>
      <div className="sched-team-info"><strong>Preferred Play Days:</strong> {playDaysStr}</div>
      {showIncompleteNote && !playedAllOpponents && (
        <div className="sched-note">Round-robin incomplete</div>
      )}
      {stats.violatedPreferences > 0 && (
        <div className="sched-note">{stats.violatedPreferences} games on preferred days off</div>
      )}

      <button type="button" className="sched-toggle" onClick={() => setOpen(o => !o)}>
        <span className={'sched-arrow' + (open ? ' expanded' : '')}>▶</span>
        <span>Opponent Details</span>
      </button>

      {open && (
        <div className="sched-team-details">
          <table>
            <thead>
              <tr>
                <th>Opponent</th>
                <th style={{ textAlign: 'center' }}>Games</th>
              </tr>
            </thead>
            <tbody>
              {sortedOpponents.length === 0 ? (
                <tr><td colSpan="2" className="muted" style={{ textAlign: 'center' }}>No games scheduled</td></tr>
              ) : sortedOpponents.map(([opponent, gameCount]) => {
                const oppDiv = teamStats[opponent] ? teamStats[opponent].division : ''
                const isCross = oppDiv && oppDiv !== stats.division
                return (
                  <tr key={opponent}>
                    <td>{opponent}{isCross && <span className="muted sched-cross-tag"> ({oppDiv})</span>}</td>
                    <td className="sched-game-count">{gameCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
