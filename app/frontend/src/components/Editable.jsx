import React, { useEffect, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import { weekLabel, fmtDate, isoDate, weekStartDate } from '../api.js'

/* Click-to-edit text. Click the text -> input/textarea; clicking out (blur) saves,
   Esc cancels. Used for descriptions, details, and individual steps. */
export function EditableText({
  value, onSave, multiline = false, placeholder = 'Click to add…',
  className = '', canEdit = true, pencil = false,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef(null)

  useEffect(() => { if (!editing) setDraft(value ?? '') }, [value, editing])
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      const len = ref.current.value.length
      try { ref.current.setSelectionRange(len, len) } catch {}
    }
  }, [editing])

  if (!canEdit) return <span className={className}>{value}</span>

  if (!editing) {
    const body = (
      <span
        className={'editable ' + className}
        title="Click to edit"
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      >
        {String(value ?? '').trim() ? value : <span className="editable-empty">{placeholder}</span>}
      </span>
    )
    if (!pencil) return body
    return (
      <span className="editable-wrap">
        {body}
        <button type="button" className="icon-btn pencil" title="Edit"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}>✎</button>
      </span>
    )
  }

  const commit = () => { setEditing(false); if ((draft ?? '') !== (value ?? '')) onSave(draft) }
  const cancel = () => { setDraft(value ?? ''); setEditing(false) }
  const props = {
    ref, value: draft, className: 'editable-input ' + className,
    onClick: (e) => e.stopPropagation(),
    onChange: (e) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel() }
      else if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit() }
    },
  }
  return multiline
    ? <textarea {...props} rows={Math.max(3, String(draft).split('\n').length + 1)} />
    : <input {...props} />
}

/* Title with a trailing pencil. Click ✎ -> editable input with a ✓; clicking ✓
   (or Enter / clicking out) saves. */
export function EditableTitle({ value, onSave, canEdit = true, className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef(null)
  const done = useRef(false)   // guards against mousedown+blur double-commit

  useEffect(() => { if (!editing) setDraft(value ?? '') }, [value, editing])
  useEffect(() => { if (editing) { done.current = false; ref.current?.focus(); ref.current?.select() } }, [editing])

  const commit = () => {
    if (done.current) return
    done.current = true
    setEditing(false)
    if ((draft ?? '') !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <span className="edit-title-wrap" onClick={(e) => e.stopPropagation()}>
        <input
          ref={ref} className={'editable-input ' + className} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); done.current = true; setDraft(value ?? ''); setEditing(false) }
          }}
        />
        {/* mouseDown fires before blur so the ✓ always wins */}
        <button type="button" className="icon-btn ok" title="Save"
          onMouseDown={(e) => { e.preventDefault(); commit() }}>✓</button>
      </span>
    )
  }

  return (
    <span className="edit-title-wrap">
      <span className={className}>{value}</span>
      {canEdit && (
        <button type="button" className="icon-btn pencil" title="Edit"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}>✎</button>
      )}
    </span>
  )
}

/* The due pill — click to pick a fiscal week, or pin an exact date.

   A task is due the Monday of its week by default. `dueDate`/`overrideDate` come
   from the server, which owns the week -> date map; this component only shows
   them and sends changes back. */
const FREQUENCY_LABELS = {
  weekly: 'Every week',
  biweekly_1_3: '1st & 3rd week of the month',
  biweekly_2_4: '2nd & 4th week of the month',
  monthly: 'Monthly',
}

export function WeekPicker({ value, onSave, canEdit = true, seasonYear, dueDate, overrideDate,
  className = '', title = 'When is this due?', recurrence = null, onRecurrence = null }) {
  const [open, setOpen] = useState(false)
  const pinned = !!overrideDate
  const label = pinned ? `${fmtDate(dueDate)} (pinned)` : weekLabel(value, seasonYear)

  if (!canEdit) return <span className={`pill ${className}${pinned ? ' pill-pinned' : ''}`}>{label}</span>

  return (
    <>
      <span className={`pill pill-btn ${className}${pinned ? ' pill-pinned' : ''}`}
        title={pinned ? 'Pinned to an exact date — click to change' : 'Click to change the due week'}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}>{label}</span>
      {open && (
        <Modal title={title} wide onClose={() => setOpen(false)}
          footer={<button type="button" className="secondary"
            onClick={() => { onSave({ dueWeekOfFY: null, dueDateOverride: null }); setOpen(false) }}>Clear due date</button>}>
          <p className="muted" style={{ marginTop: 0 }}>
            The fiscal year runs Oct 1 – Sep 30; week 1 is the week containing Oct 1.
            Tasks are due the <strong>Monday</strong> of their week unless you pin an exact date.
          </p>

          <label>Exact date (optional)</label>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" style={{ maxWidth: 200 }}
              value={overrideDate ? isoDate(overrideDate) : ''}
              onChange={(e) => { onSave({ dueDateOverride: e.target.value || null }); setOpen(false) }} />
            {pinned && (
              <button type="button" className="secondary"
                onClick={() => { onSave({ dueDateOverride: null }); setOpen(false) }}>
                Use the week's date instead
              </button>
            )}
          </div>

          {onRecurrence && (<>
            <div className="checklist-head" style={{ marginTop: 18 }}>Repeat</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select style={{ flex: '1 1 220px', minWidth: 0 }}
                value={recurrence?.frequency || ''}
                onChange={(e) => { onRecurrence(e.target.value || null); setOpen(false) }}>
                <option value="">Does not repeat</option>
                {Object.entries(FREQUENCY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
            <p className="muted" style={{ fontSize: '0.76rem', marginTop: 6 }}>
              Occurrences are created from this week through the end of the season.
            </p>
          </>)}

          <div className="checklist-head" style={{ marginTop: 18 }}>Or pick a week</div>
          <div className="week-grid">
            {Array.from({ length: 52 }, (_, w) => {
              const d = weekStartDate(seasonYear, w)
              return (
                <button key={w} type="button"
                  className={'week-cell' + (w === value && !pinned ? ' active' : '')}
                  onClick={() => { onSave({ dueWeekOfFY: w, dueDateOverride: null }); setOpen(false) }}>
                  <span className="wk">wk {w + 1}</span>
                  <span className="mo">{d ? fmtDate(d) : ''}</span>
                </button>
              )
            })}
          </div>
        </Modal>
      )}
    </>
  )
}
