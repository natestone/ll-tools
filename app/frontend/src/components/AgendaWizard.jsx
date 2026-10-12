import React, { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { api, weekLabel } from '../api.js'
import { DateField } from './DateField.jsx'

// Standing sections every board meeting carries (mirrors the seeded template).
const STANDING = [
  'Call to order · attendance & quorum',
  'Approve previous meeting minutes',
  "Treasurer's report",
  'Old business',
  'New business',
  'Adjourn',
]

const todayStr = () => new Date().toISOString().slice(0, 10)

// Fiscal-year week for a date (FY starts Oct 1; week 0 = week containing Oct 1).
export function fyWeek(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const y = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1
  const start = new Date(y, 9, 1)
  return Math.max(0, Math.min(51, Math.floor((d - start) / (7 * 86400000))))
}

export default function AgendaWizard({ leagueId, onClose, onCreated, seasonYear }) {
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState({
    title: 'Board Meeting', meetingDate: todayStr(), startTime: '18:30',
    location: '', facilitator: '', recorder: '',
  })
  const [standing, setStanding] = useState(STANDING.map((t) => ({ text: t, on: true })))
  const [allRoles, setAllRoles] = useState(false)
  const [cands, setCands] = useState([])
  const [picked, setPicked] = useState({})      // "taskId:stepIndex" -> item
  const [custom, setCustom] = useState([])
  const [customText, setCustomText] = useState('')

  const week = fyWeek(d.meetingDate)

  useEffect(() => {
    if (step !== 2) return
    const qs = new URLSearchParams({ week: String(week ?? ''), roleKey: allRoles ? 'all' : 'president' })
    api.get(`/leagues/${leagueId}/meetings/candidates?${qs}`).then(setCands).catch(() => setCands([]))
  }, [step, allRoles, week, leagueId])

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }))
  const togglePick = (task, stepIndex, text) => {
    const key = `${task.id}:${stepIndex}`
    setPicked((p) => {
      const n = { ...p }
      if (n[key]) delete n[key]
      else n[key] = { text, source: 'task-step', roleKey: task.roleKey, taskId: task.id, stepIndex }
      return n
    })
  }

  const items = [
    ...standing.filter((s) => s.on).map((s) => ({ text: s.text, source: 'standing' })),
    ...Object.values(picked),
    ...custom.map((t) => ({ text: t, source: 'custom' })),
  ]

  async function create() {
    setBusy(true)
    try {
      const m = await api.post(`/leagues/${leagueId}/meetings`, { ...d, items })
      onCreated(m)
    } finally { setBusy(false) }
  }

  const footer = (
    <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
      <span className="muted">Step {step} of 3{step === 2 && week != null ? ` · ${weekLabel(week, seasonYear)}` : ''}</span>
      <span className="row" style={{ gap: 8 }}>
        {step > 1 && <button type="button" className="secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3 && <button type="button" onClick={() => setStep(step + 1)}>Next</button>}
        {step === 3 && <button type="button" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create meeting'}</button>}
      </span>
    </div>
  )

  return (
    <Modal title="Generate agenda" wide onClose={onClose} footer={footer}>
      {step === 1 && (
        <>
          <label>Meeting title</label>
          <input value={d.title} onChange={(e) => set('title', e.target.value)} />
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Date</label>
              <DateField value={d.meetingDate} onChange={(v) => set('meetingDate', v)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Start time</label>
              <input value={d.startTime} onChange={(e) => set('startTime', e.target.value)} placeholder="18:30" />
            </div>
          </div>
          <label>Location / link</label>
          <input value={d.location} onChange={(e) => set('location', e.target.value)} />
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Facilitator</label>
              <input value={d.facilitator} onChange={(e) => set('facilitator', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Recorder</label>
              <input value={d.recorder} onChange={(e) => set('recorder', e.target.value)} />
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="checklist-head">Standing items</div>
          {standing.map((s, i) => (
            <label key={i} className="checkstep">
              <input type="checkbox" checked={s.on}
                onChange={() => setStanding((a) => a.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))} />
              <span>{s.text}</span>
            </label>
          ))}

          <div className="checklist-head" style={{ marginTop: 16 }}>
            Task steps due near this meeting
            <label className="muted" style={{ marginLeft: 10, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              <input type="checkbox" style={{ width: 'auto', marginRight: 5 }}
                checked={allRoles} onChange={(e) => setAllRoles(e.target.checked)} />
              include all roles
            </label>
          </div>
          {cands.length === 0 && <p className="muted">Nothing due around this week.</p>}
          <div className="cand-list">
            {cands.map((t) => (
              <div key={t.id} className="cand-task">
                <div className="cand-task-head">
                  {t.title} <span className="pill">{weekLabel(t.dueWeekOfFY, seasonYear)}</span>
                  {allRoles && <span className="badge">{t.roleKey.replace(/_/g, ' ')}</span>}
                </div>
                {(t.steps || []).map((s, i) => (
                  <label key={i} className="checkstep">
                    <input type="checkbox" checked={!!picked[`${t.id}:${i}`]} onChange={() => togglePick(t, i, s)} />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="checklist-head" style={{ marginTop: 16 }}>Custom items</div>
          {custom.map((c, i) => (
            <div key={i} className="checkstep">
              <span style={{ flex: 1 }}>{c}</span>
              <button type="button" className="icon-btn danger"
                onClick={() => setCustom((a) => a.filter((_, k) => k !== i))}>×</button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <input value={customText} placeholder="Add an agenda item…"
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customText.trim()) {
                  e.preventDefault(); setCustom((a) => [...a, customText.trim()]); setCustomText('')
                }
              }} />
            <button type="button" className="secondary" disabled={!customText.trim()}
              onClick={() => { setCustom((a) => [...a, customText.trim()]); setCustomText('') }}>Add</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            <strong>{d.title}</strong> — {d.meetingDate} {d.startTime} {d.location && `· ${d.location}`}
          </p>
          <div className="checklist-head">Agenda ({items.length} items)</div>
          <ol className="review-list">
            {items.map((it, i) => (
              <li key={i}>{it.text} {it.source !== 'custom' && <span className="badge">{it.source === 'standing' ? 'standing' : it.roleKey?.replace(/_/g, ' ')}</span>}</li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  )
}
