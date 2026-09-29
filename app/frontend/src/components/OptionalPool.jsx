import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

/* Archived tasks + archived steps for a season — the "optional" pool that a
   future season can pull from. Nothing here is lost unless deleted explicitly. */
export default function OptionalPool({ leagueId, seasonYear, roleKey, activeTasks = [], onChanged, canEdit }) {
  const [open, setOpen] = useState(false)
  const [archived, setArchived] = useState([])
  const [target, setTarget] = useState({})   // poolKey -> target task id
  const [busy, setBusy] = useState('')

  const qs = (extra = '') =>
    `?archived=1${seasonYear != null ? `&season=${seasonYear}` : ''}${roleKey ? `&roleKey=${roleKey}` : ''}${extra}`
  const load = () => api.get(`/leagues/${leagueId}/tasks${qs()}`).then(setArchived).catch(() => setArchived([]))
  useEffect(() => { load() }, [leagueId, seasonYear, roleKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // archived steps can live on active or archived tasks
  const steps = [...activeTasks, ...archived].flatMap((t) =>
    (t.archivedSteps || []).map((text) => ({ text, fromTaskId: t.id, fromTitle: t.title })))

  const total = archived.length + steps.length
  if (!total) return null

  const pick = (k) => target[k] || (activeTasks[0] && activeTasks[0].id) || ''

  async function restoreTask(t) {
    setBusy(`t${t.id}`)
    await api.post(`/leagues/${leagueId}/tasks/${t.id}/restore`)
    setBusy(''); await load(); onChanged?.()
  }
  async function taskToStep(t) {
    const id = pick(`t${t.id}`)
    if (!id) return
    setBusy(`t${t.id}`)
    const tgt = activeTasks.find((x) => x.id === Number(id))
    await api.patch(`/leagues/${leagueId}/tasks/${id}`, { steps: [...(tgt?.steps || []), t.title] })
    setBusy(''); onChanged?.()
  }
  async function hardDelete(t) {
    if (!window.confirm(`Permanently delete "${t.title}"? This cannot be undone.`)) return
    setBusy(`t${t.id}`)
    await api.del(`/leagues/${leagueId}/tasks/${t.id}?hard=1`)
    setBusy(''); await load(); onChanged?.()
  }
  async function stepToTask(s, i) {
    const id = pick(`s${i}`)
    if (!id) return
    setBusy(`s${i}`)
    await api.post(`/leagues/${leagueId}/tasks/${s.fromTaskId}/steps/restore`, { text: s.text, targetTaskId: id })
    setBusy(''); await load(); onChanged?.()
  }

  const TargetSelect = ({ k }) => (
    <select value={pick(k)} onChange={(e) => setTarget((x) => ({ ...x, [k]: e.target.value }))} className="pool-select">
      {activeTasks.map((t) => <option key={t.id} value={t.id}>{t.title.slice(0, 60)}</option>)}
    </select>
  )

  return (
    <div className="optional-pool">
      <div className="section-head" style={{ cursor: 'pointer', marginBottom: open ? 12 : 0 }} onClick={() => setOpen((o) => !o)}>
        <h3 style={{ margin: 0 }}>
          <span className="expander">{open ? '▾' : '▸'}</span> Optional / archived
          <span className="pill" style={{ marginLeft: 8 }}>{total}</span>
        </h3>
      </div>
      {open && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Kept from earlier seasons. Restore an item to this season's list, or fold it into an existing task as a step.
          </p>

          {archived.map((t) => (
            <div key={t.id} className="pool-row">
              <span className="pool-kind">task</span>
              <span className="pool-text">{t.title}</span>
              {canEdit && (
                <span className="pool-actions">
                  <button type="button" className="secondary" disabled={busy === `t${t.id}`} onClick={() => restoreTask(t)}>Restore</button>
                  {activeTasks.length > 0 && <>
                    <TargetSelect k={`t${t.id}`} />
                    <button type="button" className="secondary" disabled={busy === `t${t.id}`} onClick={() => taskToStep(t)}>→ step</button>
                  </>}
                  <button type="button" className="icon-btn danger" title="Delete permanently" onClick={() => hardDelete(t)}>×</button>
                </span>
              )}
            </div>
          ))}

          {steps.map((s, i) => (
            <div key={`s${i}`} className="pool-row">
              <span className="pool-kind step">step</span>
              <span className="pool-text">{s.text}<span className="muted"> — from “{s.fromTitle.slice(0, 40)}”</span></span>
              {canEdit && activeTasks.length > 0 && (
                <span className="pool-actions">
                  <TargetSelect k={`s${i}`} />
                  <button type="button" className="secondary" disabled={busy === `s${i}`} onClick={() => stepToTask(s, i)}>Add to task</button>
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
