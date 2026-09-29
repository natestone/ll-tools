import React, { useEffect, useState } from 'react'
import { useOutletContext, useParams, Link } from 'react-router-dom'
import { api, weekLabel } from '../api.js'
import { WeekPicker } from '../components/Editable.jsx'
import TaskItem from '../components/TaskItem.jsx'
import OptionalPool from '../components/OptionalPool.jsx'

export default function RoleView() {
  const { leagueId, league, seasonYear } = useOutletContext()
  const { roleKey } = useParams()
  const [roles, setRoles] = useState([])
  const [cal, setCal] = useState([])
  const [tasks, setTasks] = useState([])
  const [templates, setTemplates] = useState([])

  const moveCal = async (id, patch) => {
    const updated = await api.patch(`/leagues/${leagueId}/calendar/${id}`, patch)
    setCal((xs) => xs.map((x) => (x.id === id ? { ...x, ...updated } : x)))
  }

  // Look the role up in the league's full list, not just the viewer's own roles —
  // an owner opening another officer's page would otherwise see the raw key
  // ("grounds_crew") as the page heading.
  const role = roles.find((r) => r.key === roleKey)
    || league.myRoles.find((r) => r.key === roleKey)
    || { name: roleKey }

  const seasonQS = seasonYear != null ? `&season=${seasonYear}` : ''
  const load = () => Promise.all([
    api.get(`/leagues/${leagueId}/roles`).then(setRoles).catch(() => setRoles([])),
    api.get(`/leagues/${leagueId}/calendar?roleKey=${roleKey}`).then(setCal),
    api.get(`/leagues/${leagueId}/tasks?roleKey=${roleKey}${seasonQS}`).then(setTasks),
    api.get(`/leagues/${leagueId}/email-templates?roleKey=${roleKey}`).then(setTemplates),
  ])
  useEffect(() => { load() }, [leagueId, roleKey, seasonYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateTask = (t) => setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...t } : x)))
  const removeTask = async (t) => {
    await api.del(`/leagues/${leagueId}/tasks/${t.id}`)   // archives, doesn't destroy
    setTasks((ts) => ts.filter((x) => x.id !== t.id))
  }
  const duplicateTask = async (t) => {
    const copy = await api.post(`/leagues/${leagueId}/tasks/${t.id}/duplicate`)
    setTasks((ts) => [...ts, copy])
  }
  const canEdit = !!league?.isOwner || !!league?.myRoles?.some((r) => r.key === roleKey)
  const addTask = async () => {
    const t = await api.post(`/leagues/${leagueId}/tasks${seasonYear != null ? `?season=${seasonYear}` : ''}`,
      { roleKey, title: 'New task', steps: [''] })
    setTasks((ts) => [...ts, { ...t, __isNew: true }])
  }

  return (
    <div>
      <h1>{role.name}</h1>

      <div className="card">
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Task list</h2>
          {canEdit && (
            <button type="button" className="icon-btn add" title="Add a task" onClick={addTask}>+</button>
          )}
        </div>
        {tasks.length === 0 && <p className="muted">No tasks for this role.</p>}
        {tasks.map((t) => (
          <TaskItem key={t.id} task={t} leagueId={leagueId} seasonYear={seasonYear}
            onDuplicate={duplicateTask} onSeriesChanged={load} onChange={updateTask}
            onDelete={removeTask} canEdit={canEdit} />
        ))}
        <OptionalPool leagueId={leagueId} seasonYear={seasonYear} roleKey={roleKey}
          activeTasks={tasks} canEdit={canEdit} onChanged={load} />
      </div>

      <div className="card">
        <h2>Calendar</h2>
        {cal.length === 0 && <p className="muted">No calendar items for this role.</p>}
        {cal.map((c) => (
          <div key={c.id} className="cal-row">
            <WeekPicker value={c.weekOfFY} canEdit={!!c.canEdit} seasonYear={seasonYear}
              dueDate={c.dueDate} overrideDate={c.dateOverride} className="cal-week"
              title="When is this?"
              onSave={(patch) => moveCal(c.id, {
                ...(patch.dueWeekOfFY !== undefined ? { weekOfFY: patch.dueWeekOfFY } : {}),
                ...(patch.dueDateOverride !== undefined ? { dateOverride: patch.dueDateOverride } : {}),
              })} />
            <span className="badge">{c.kind}</span>
            <div className="cal-title">{c.title}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Email templates</h2>
        {templates.length === 0 && <p className="muted">No templates for this role.</p>}
        {templates.map((t) => (
          <div key={t.id} className="tpl-row">
            <Link to={`../templates?open=${encodeURIComponent(t.key || '')}`}>{t.subject}</Link>
            <span className="pill">{weekLabel(t.weekOfFY, seasonYear)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
