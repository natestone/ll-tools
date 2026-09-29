import React from 'react'

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DEFAULT_TEAMS = ['Yankees', 'Red Sox', 'Blue Jays', 'Orioles', 'Rays', 'Cardinals', 'Cubs', 'Reds', 'Pirates']

function emptyTeam(primaryDivision) {
  return {
    name: '',
    primaryDivision: primaryDivision || '',
    homeField: '',
    gamesPerWeek: '2',
    daysOff: [],
    crossDivisions: [],
  }
}

// Controlled list of teams. `teams` is the array of team config objects.
// `divisions` and `fields` (arrays of names) drive the dropdowns / cross-play.
export default function TeamSetup({ teams, divisions, fields, onChange }) {
  const filled = teams.filter(t => t.name.trim() !== '').length
  const validDivisions = divisions.filter(d => d.trim() !== '')
  const validFields = fields.filter(f => f.trim() !== '')

  const update = (i, patch) => onChange(teams.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  const addTeam = () => onChange([emptyTeam(validDivisions[0]), ...teams])
  const removeTeam = (i) => onChange(teams.filter((_, idx) => idx !== i))

  const toggleDayOff = (i, day) => {
    const team = teams[i]
    const daysOff = team.daysOff.includes(day)
      ? team.daysOff.filter(d => d !== day)
      : [...team.daysOff, day]
    update(i, { daysOff })
  }
  const toggleCross = (i, div) => {
    const team = teams[i]
    const crossDivisions = team.crossDivisions.includes(div)
      ? team.crossDivisions.filter(d => d !== div)
      : [...team.crossDivisions, div]
    update(i, { crossDivisions })
  }

  const loadSample = () => {
    const next = DEFAULT_TEAMS.map((name, index) => {
      const t = emptyTeam(validDivisions[0])
      t.name = name
      // First 5 -> division[0], next 4 -> division[1]
      if (validDivisions.length >= 2) {
        t.primaryDivision = index < 5 ? validDivisions[0] : validDivisions[1]
      } else if (validDivisions.length === 1) {
        t.primaryDivision = validDivisions[0]
      }
      // Home fields cyclic
      if (validFields.length > 0) {
        t.homeField = validFields[index % validFields.length]
      }
      // Every 3rd team a sample day off (Monday=1 / Wednesday=3)
      if (index % 3 === 0) t.daysOff = [1]
      else if (index % 3 === 1) t.daysOff = [3]
      return t
    })
    onChange(next)
  }
  const clearAll = () => onChange([emptyTeam(validDivisions[0]), emptyTeam(validDivisions[0]), emptyTeam(validDivisions[0])])

  return (
    <div className="sched-section">
      <div className="sched-section-head">
        <h3>Team Setup</h3>
        <button type="button" className="sched-btn-small sched-btn-add" title="Add Team" onClick={addTeam}>+</button>
      </div>
      <div className="sched-count">{filled} teams entered</div>
      <p className="muted sched-hint">
        Each row: team name · primary division · home field · target games/week. Use the row below each team to opt into inter-division play and preferred play days.
      </p>

      {teams.map((team, i) => {
        // Primary division excluded from cross-play options.
        const primary = team.primaryDivision || (validDivisions[0] || '')
        const otherDivisions = validDivisions.filter(d => d !== primary)
        return (
          <div className="sched-team-block" key={i}>
            {/* .sched-inline-label is hidden on desktop and revealed when the row
                stacks on phones (see scheduler.css). The remove button must stay
                the LAST child — the phone grid pins it beside the name field. */}
            <div className="sched-input-row sched-team-row">
              <label className="sched-inline-label" htmlFor={`sched-team-name-${i}`}>Team Name</label>
              <input
                id={`sched-team-name-${i}`}
                type="text"
                placeholder="Enter team name"
                value={team.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <label className="sched-inline-label" htmlFor={`sched-team-div-${i}`}>Primary Division</label>
              <select
                id={`sched-team-div-${i}`}
                className="sched-select"
                title="Primary division"
                value={team.primaryDivision}
                onChange={(e) => update(i, { primaryDivision: e.target.value })}
              >
                {validDivisions.length === 0
                  ? <option value="">No divisions defined</option>
                  : validDivisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <label className="sched-inline-label" htmlFor={`sched-team-field-${i}`}>Home Field</label>
              <select
                id={`sched-team-field-${i}`}
                className="sched-select"
                value={team.homeField}
                onChange={(e) => update(i, { homeField: e.target.value })}
              >
                <option value="">No home field</option>
                {validFields.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <label className="sched-inline-label" htmlFor={`sched-team-gpw-${i}`}>Games / Week</label>
              <input
                id={`sched-team-gpw-${i}`}
                type="number"
                className="sched-gpw"
                min="1"
                max="7"
                step="1"
                title="Target games per week"
                value={team.gamesPerWeek}
                onChange={(e) => update(i, { gamesPerWeek: e.target.value })}
              />
              <button type="button" className="sched-btn-small sched-btn-remove" title="Remove Team" aria-label="Remove team" onClick={() => removeTeam(i)}>−</button>
            </div>

            <div className="sched-crossplay">
              {otherDivisions.length === 0 ? (
                <span className="sched-crossplay-label">Also plays against: <span className="sched-crossplay-none">no other divisions available</span></span>
              ) : (
                <>
                  <span className="sched-crossplay-label">Also plays against:</span>
                  {otherDivisions.map(div => (
                    <label className="sched-checkbox" key={div}>
                      <input
                        type="checkbox"
                        checked={team.crossDivisions.includes(div)}
                        onChange={() => toggleCross(i, div)}
                      />
                      {div}
                    </label>
                  ))}
                </>
              )}
            </div>

            <div className="sched-daysoff">
              <span className="sched-daysoff-label">Preferred play days:</span>
              {dayNames.map((dn, di) => (
                <label className="sched-checkbox" key={di}>
                  <input
                    type="checkbox"
                    checked={!team.daysOff.includes(di)}
                    onChange={() => toggleDayOff(i, di)}
                  />
                  {dn}
                </label>
              ))}
            </div>
          </div>
        )
      })}

      <div className="sched-section-actions">
        <button type="button" className="secondary" onClick={loadSample}>Load Sample Teams</button>
        <button type="button" className="secondary" onClick={clearAll}>Clear All</button>
      </div>
    </div>
  )
}
