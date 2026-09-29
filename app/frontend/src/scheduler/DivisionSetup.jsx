import React from 'react'

const DEFAULT_DIVISIONS = ['American', 'National', 'Central', 'Pacific']

// Controlled list of division-name inputs. `divisions` is an array of strings.
export default function DivisionSetup({ divisions, onChange }) {
  const filled = divisions.filter(d => d.trim() !== '').length

  const update = (i, value) => {
    const next = divisions.slice()
    next[i] = value
    onChange(next)
  }
  const add = () => onChange(['', ...divisions])
  const remove = (i) => onChange(divisions.filter((_, idx) => idx !== i))
  const loadSample = () => onChange([...DEFAULT_DIVISIONS])
  const clearAll = () => onChange([''])

  return (
    <div className="sched-section">
      <div className="sched-section-head">
        <h3>Division Setup</h3>
        <button type="button" className="sched-btn-small sched-btn-add" title="Add Division" onClick={add}>+</button>
      </div>
      <div className="sched-count">{filled} divisions entered</div>

      {divisions.map((name, i) => (
        <div className="sched-input-row" key={i}>
          <input
            type="text"
            placeholder="Enter division name"
            value={name}
            onChange={(e) => update(i, e.target.value)}
          />
          <button type="button" className="sched-btn-small sched-btn-remove" title="Remove Division" onClick={() => remove(i)}>−</button>
        </div>
      ))}

      <div className="sched-section-actions">
        <button type="button" className="secondary" onClick={loadSample}>Load Sample Divisions</button>
        <button type="button" className="secondary" onClick={clearAll}>Clear All</button>
      </div>
    </div>
  )
}
