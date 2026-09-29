import React, { useEffect, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { api } from '../api.js'

export default function OwnerDashboard() {
  const { leagueId } = useOutletContext()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get(`/leagues/${leagueId}/dashboard`).then(setData).catch((e) => setErr(e.message)) }, [leagueId])

  if (err) return <p className="err">{err}</p>
  if (!data) return <p>Loading…</p>
  const pct = (d, t) => (t ? Math.round((100 * d) / t) : 0)

  return (
    <div>
      <h1>{data.league.name} — Owner Dashboard</h1>
      <div className="grid cols2" style={{ marginBottom: 8 }}>
        <div className="card accent"><h3>Members</h3><div className="bignum">{data.memberCount}</div></div>
        <div className="card accent"><h3>Tasks complete</h3>
          <div className="bignum">{data.taskTotals.done}<span style={{ color: 'var(--muted)', fontSize: '1.4rem' }}>/{data.taskTotals.total}</span></div>
          <div className="progress" style={{ marginTop: 8 }}><div style={{ width: pct(data.taskTotals.done, data.taskTotals.total) + '%' }} /></div>
        </div>
      </div>
      <div className="card">
        <h2>Roles</h2>
        {/* A genuine 5-column data table: it must scroll inside .table-scroll on a
            phone rather than stack label-less (thead is hidden by the global rule),
            and never widen the page. */}
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Role</th><th>Holder(s)</th><th>Calendar</th><th>Tasks</th><th className="col-progress" style={{ width: 160 }}>Progress</th></tr></thead>
            <tbody>
              {data.roles.map((r) => (
                <tr key={r.key}>
                  <td><Link to={`../role/${r.key}`}>{r.name}</Link></td>
                  <td>{r.holders.length ? r.holders.join(', ') : <span className="muted">unassigned</span>}</td>
                  <td>{r.calendarCount}</td>
                  <td>{r.taskDone}/{r.taskTotal}</td>
                  <td><div className="progress"><div style={{ width: pct(r.taskDone, r.taskTotal) + '%' }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
