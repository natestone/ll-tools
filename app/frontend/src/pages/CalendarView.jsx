import React, { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { api, fmtDate } from '../api.js'

/* The calendar is assembled from the tasks plus a handful of standalone events,
   not stored as its own list. It used to be its own table of rows distilled in
   parallel with the tasks, which meant deleting a task left its calendar twin
   behind — and the two drifted apart whenever either was edited. Task entries
   here are the task rows, so they are correct by construction. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthKey = (iso) => (iso ? iso.slice(0, 7) : '')
const monthLabel = (key) => {
  const [y, m] = key.split('-')
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`
}

export default function CalendarView() {
  const { leagueId, league, seasonYear } = useOutletContext()
  const [data, setData] = useState(null)
  const [showDone, setShowDone] = useState(false)

  const load = () => api.get(`/leagues/${leagueId}/calendar/agenda`).then(setData)
  useEffect(() => { load() }, [leagueId, seasonYear]) // eslint-disable-line react-hooks/exhaustive-deps

  async function removeEvent(row) {
    if (!window.confirm(`Remove "${row.title}" from the calendar?`)) return
    await api.del(`/leagues/${leagueId}/calendar/${row.id}`)
    await load()
  }

  if (!data) return <p>Loading…</p>
  const rows = data.rows.filter((r) => showDone || r.kind !== 'done')
  const months = [...new Set(rows.map((r) => monthKey(r.date)))].filter(Boolean)

  return (
    <div>
      <h1>League Calendar <span className="muted">(fiscal year, Oct → Sep)</span></h1>
      <p className="muted" style={{ marginTop: -8 }}>
        {data.counts.tasks} task{data.counts.tasks === 1 ? '' : 's'} and {data.counts.events} event
        {data.counts.events === 1 ? '' : 's'}. Tasks appear here automatically — add, move or delete
        them from the task lists and the calendar follows.
        {' '}
        <a href="#" onClick={(e) => { e.preventDefault(); setShowDone((v) => !v) }}>
          {showDone ? 'Hide completed' : 'Show completed'}
        </a>
      </p>

      {months.map((mk) => (
        <div className="card" key={mk}>
          <h2>{monthLabel(mk)}</h2>
          {rows.filter((r) => monthKey(r.date) === mk).map((r) => (
            <div key={`${r.type}-${r.id}`} className="cal-row">
              <span className={'pill cal-week' + (r.isDateOverridden ? ' pill-pinned' : '')}>{fmtDate(r.date)}</span>
              <span className={'badge cal-kind-' + r.kind}>{r.kind}</span>
              <span className="badge">{r.roleKey.replace(/_/g, ' ')}</span>
              <div className={'cal-title' + (r.kind === 'done' ? ' taskdone' : '')}>
                {r.type === 'task'
                  ? <Link to={`../role/${r.roleKey}`}>{r.title}</Link>
                  : r.title}
              </div>
              {r.type === 'event' && league?.isOwner && (
                <button type="button" className="icon-btn danger" title="Remove this event"
                  onClick={() => removeEvent(r)}>×</button>
              )}
            </div>
          ))}
        </div>
      ))}
      {rows.length === 0 && <p className="muted">Nothing scheduled.</p>}
    </div>
  )
}
