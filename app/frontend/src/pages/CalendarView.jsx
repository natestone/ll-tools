import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api.js'
import { WeekPicker } from '../components/Editable.jsx'

const PHASES = [
  ['Oct', 0, 4], ['Nov–Dec', 5, 12], ['Jan–Feb', 13, 20], ['Mar', 21, 24],
  ['Apr–May', 25, 32], ['Jun–Jul', 33, 40], ['Aug–Sep', 41, 51],
]

export default function CalendarView() {
  const { leagueId, league, seasonYear } = useOutletContext()
  const [items, setItems] = useState([])
  useEffect(() => { api.get(`/leagues/${leagueId}/calendar`).then(setItems) }, [leagueId, seasonYear])

  const move = async (id, patch) => {
    const updated = await api.patch(`/leagues/${leagueId}/calendar/${id}`, patch)
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...updated } : x)))
  }

  return (
    <div>
      <h1>League Calendar <span className="muted">(fiscal year, Oct → Sep)</span></h1>
      {league.isOwner && <p className="muted">Showing all roles. Click a date to move an item or pin it to an exact day.</p>}
      {PHASES.map(([label, lo, hi]) => {
        const group = items.filter((i) => i.weekOfFY >= lo && i.weekOfFY <= hi)
        if (!group.length) return null
        return (
          <div className="card" key={label}>
            <h2>{label}</h2>
            {group.sort((a, b) => a.weekOfFY - b.weekOfFY).map((c) => (
              <div key={c.id} className="row cal-row"
                style={{ padding: '5px 0', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
                <WeekPicker value={c.weekOfFY} canEdit={!!c.canEdit} seasonYear={seasonYear}
                  dueDate={c.dueDate} overrideDate={c.dateOverride} className="cal-week"
                  onSave={(patch) => move(c.id, {
                    ...(patch.dueWeekOfFY !== undefined ? { weekOfFY: patch.dueWeekOfFY } : {}),
                    ...(patch.dueDateOverride !== undefined ? { dateOverride: patch.dueDateOverride } : {}),
                  })} />
                <span className="badge">{c.roleKey}</span>
                {/* basis 180 so the title keeps the line on desktop but drops to its
                    own full-width line once the pill + badge crowd it on a phone */}
                <div className="cal-title" style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}>{c.title}</div>
              </div>
            ))}
          </div>
        )
      })}
      {items.length === 0 && <p className="muted">No calendar items.</p>}
    </div>
  )
}
