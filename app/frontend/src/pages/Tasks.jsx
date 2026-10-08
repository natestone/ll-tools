import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api, sortTasks, keepTaskInView } from '../api.js'
import TaskItem from '../components/TaskItem.jsx'
import OptionalPool from '../components/OptionalPool.jsx'

export default function Tasks() {
  const { league, leagueId, seasonYear } = useOutletContext()
  const [tasks, setTasks] = useState([])
  const [roles, setRoles] = useState([])

  const seasonQS = seasonYear != null ? `?season=${seasonYear}` : ''
  const load = () => Promise.all([
    api.get(`/leagues/${leagueId}/tasks${seasonQS}`).then((r) => setTasks(sortTasks(r))),
    api.get(`/leagues/${leagueId}/roles`).then(setRoles).catch(() => setRoles([])),
  ])
  useEffect(() => { load() }, [leagueId, seasonYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (t) => setTasks((ts) => {
    const merged = ts.map((x) => (x.id === t.id ? { ...x, ...t } : x))
    const next = sortTasks(merged)
    const within = (list) => list.filter((x) => x.roleKey === t.roleKey).findIndex((x) => x.id === t.id)
    keepTaskInView(t.id, within(ts), within(next))
    return next
  })
  const remove = async (t) => {
    await api.del(`/leagues/${leagueId}/tasks/${t.id}`)   // archives, doesn't destroy
    setTasks((ts) => ts.filter((x) => x.id !== t.id))
  }
  const duplicateTask = async (t) => {
    const copy = await api.post(`/leagues/${leagueId}/tasks/${t.id}/duplicate`)
    setTasks((ts) => [...ts, copy])
  }
  const canEditRole = (rk) => !!league?.isOwner || !!league?.myRoles?.some((r) => r.key === rk)
  const addTask = async (rk) => {
    const t = await api.post(`/leagues/${leagueId}/tasks${seasonQS}`, { roleKey: rk, title: 'New task', steps: [''] })
    setTasks((ts) => [...ts, { ...t, __isNew: true }])
  }

  const byRole = tasks.reduce((m, t) => ((m[t.roleKey] ??= []).push(t), m), {})

  return (
    <div>
      <h1>Tasks</h1>
      <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>
        Expand a task to see its steps and linked resources. Click any text (or its ✎) to edit.
      </p>
      {Object.keys(byRole).sort().map((rk) => (
        <div className="card" key={rk}>
          <div className="section-head">
            <h2 style={{ textTransform: 'capitalize', margin: 0 }}>{rk.replace(/_/g, ' ')}</h2>
            {canEditRole(rk) && (
              <button type="button" className="icon-btn add" title="Add a task" onClick={() => addTask(rk)}>+</button>
            )}
          </div>
          {byRole[rk].map((t) => (
            <TaskItem key={t.id} task={t} leagueId={leagueId} seasonYear={seasonYear}
            onDuplicate={duplicateTask} onSeriesChanged={load} roles={roles} onChange={update}
              onDelete={remove} canEdit={canEditRole(rk)} />
          ))}
          <OptionalPool leagueId={leagueId} seasonYear={seasonYear} roleKey={rk}
            activeTasks={byRole[rk]} canEdit={canEditRole(rk)} onChanged={load} />
        </div>
      ))}
      {tasks.length === 0 && <p className="muted">No tasks in this season.</p>}
    </div>
  )
}
