import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { MarkdownView } from './Markdown.jsx'
import { EditableText, EditableTitle, WeekPicker } from './Editable.jsx'
import LinkPicker from './LinkPicker.jsx'

// "Board Meeting" alone is ambiguous once there is more than one draft; include
// the date so the confirmation points at a specific meeting.
const meetingLabel = (m) => (m?.meetingDate
  ? `${m.title} (${new Date(m.meetingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })})`
  : (m?.title || 'the board meeting'))

const LINK_ICON = { policy: '§', reference: '📄', template: '✉', url: '🔗' }

/* Markdown details: rendered when idle, textarea while editing (click-out saves). */
function DetailsBlock({ value, onSave, canEdit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef(null)
  useEffect(() => { if (!editing) setDraft(value ?? '') }, [value, editing])
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  if (editing) {
    const commit = () => { setEditing(false); if ((draft ?? '') !== (value ?? '')) onSave(draft) }
    return (
      <textarea ref={ref} className="editable-input" value={draft}
        rows={Math.max(4, String(draft).split('\n').length + 1)}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }} />
    )
  }
  if (!String(value ?? '').trim()) {
    return canEdit
      ? <p className="editable editable-empty" onClick={(e) => { e.stopPropagation(); setEditing(true) }}>Click to add details…</p>
      : null
  }
  return (
    <div className="details-wrap">
      <div className={canEdit ? 'editable md-editable' : ''} title={canEdit ? 'Click to edit' : undefined}
        onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true) } : undefined}>
        <MarkdownView source={value} />
      </div>
      {canEdit && (
        <button type="button" className="icon-btn pencil details-pencil" title="Edit details"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}>✎</button>
      )}
    </div>
  )
}

// Expandable task "playbook": editable title/week/description/details, an interactive
// checklist, and resource links. All edits persist via PATCH /tasks/:id.
export default function TaskItem({ task, leagueId, onChange, onDelete, onDuplicate, onSeriesChanged, roles = [], canEdit = false, seasonYear }) {
  const [open, setOpen] = useState(!!task.__isNew)
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [agendaMsg, setAgendaMsg] = useState(null)
  const [seriesMsg, setSeriesMsg] = useState('')
  const dragFrom = useRef(null)
  const [overStep, setOverStep] = useState(null)
  const nav = useNavigate()

  const steps = task.steps || []
  const doneSet = new Set(task.stepsDone || [])
  const links = task.links || []
  // once editable, always expandable (so empty sections can be filled in)
  const hasBody = canEdit || !!(task.details?.trim() || steps.length || links.length)

  /* Shared fields in a recurring series prompt before spreading. Per-occurrence
     fields (week, done, ticked steps) never travel, so they skip the prompt. */
  const SHARED_FIELDS = ['title', 'description', 'details', 'steps', 'links']
  const save = async (patch) => {
    let body = patch
    const touchesShared = Object.keys(patch).some((k) => SHARED_FIELDS.includes(k))
    if (task.seriesId && touchesShared) {
      body = { ...patch, applyToSeries: window.confirm(
        'This task repeats.\n\nOK — update every occurrence in the series.\nCancel — change only this one.') }
    }
    const r = await api.patch(`/leagues/${leagueId}/tasks/${task.id}`, body)
    if (r.series) {
      setSeriesMsg(`Updated ${r.series.updated} of ${r.series.total} occurrences`
        + (r.series.skipped ? ` — ${r.series.skipped} left alone (edited separately)` : ''))
      // siblings changed server-side; without this the other occurrences on screen
      // keep showing their old text until the page is reloaded by hand
      onSeriesChanged?.()
    }
    onChange(r)
  }
  // Creating or clearing a series rewrites sibling rows, so the caller reloads.
  const setRecurrence = async (frequency) => {
    try {
      if (!frequency) {
        const drop = window.confirm('Stop repeating.\n\nOK — also delete the later occurrences nobody has started.\nCancel — keep them as standalone tasks.')
        await api.del(`/leagues/${leagueId}/tasks/${task.id}/recurrence${drop ? '?future=1' : ''}`)
      } else {
        const r = await api.post(`/leagues/${leagueId}/tasks/${task.id}/recurrence`, { frequency })
        setSeriesMsg(`Repeats — ${r.occurrences} occurrences this season`)
      }
      onSeriesChanged?.()
    } catch (e) { setSeriesMsg(e.message || 'Could not set the repeat') }
  }
  const duplicateStep = (i) => save({ steps: [...steps.slice(0, i + 1), steps[i], ...steps.slice(i + 1)] })

  async function toggleStatus(e) {
    e.stopPropagation()
    await save({ status: task.status === 'done' ? 'open' : 'done' })
  }
  async function toggleStep(i) {
    const next = new Set(doneSet); next.has(i) ? next.delete(i) : next.add(i)
    await save({ stepsDone: [...next].sort((a, b) => a - b) })
  }
  const setStep = (i, text) => save({ steps: steps.map((s, k) => (k === i ? text : s)) })

  /* Reorder steps by drag.

     stepsDone holds INDICES, not step text, so a ticked step would appear to
     move its tick to whatever step took its place unless the indices are
     remapped alongside the array. */
  function moveStep(from, to) {
    dragFrom.current = null
    setOverStep(null)
    if (from == null || to == null || from === to) return
    const next = [...steps]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const nextDone = [...doneSet].map((o) => {
      if (o === from) return to
      if (from < to) return (o > from && o <= to) ? o - 1 : o
      return (o >= to && o < from) ? o + 1 : o
    }).sort((a, b) => a - b)
    return save({ steps: next, stepsDone: nextDone })
  }
  const addStep = () => save({ steps: [...steps, ''] })
  function deleteStep(i) {
    // Archive rather than destroy: the step joins the optional pool for later
    // seasons. Checked indices are re-mapped so progress stays correct.
    const nextDone = [...doneSet].filter((d) => d !== i).map((d) => (d > i ? d - 1 : d)).sort((a, b) => a - b)
    return save({ steps: steps.filter((_, k) => k !== i), stepsDone: nextDone, archiveStep: steps[i] })
  }
  const addLink = (l) => save({ links: [...links, l] })
  const removeLink = (i) => save({ links: links.filter((_, k) => k !== i) })

  function openLink(l) {
    if (l.type === 'url') { window.open(l.ref, '_blank', 'noopener'); return }
    if (l.type === 'template') nav(`/l/${leagueId}/templates?open=${encodeURIComponent(l.ref)}`)
    else nav(`/l/${leagueId}/policies?open=${encodeURIComponent(l.ref)}`)
  }

  /* Push a step onto the current draft board meeting (creating one if needed).

     The confirmation names the meeting and links to it: "Added to agenda ✓" on its
     own told you nothing about WHERE it went, so the items looked like they had
     vanished. It also stays until you navigate away rather than clearing itself
     after two seconds. */
  async function addToAgenda(text) {
    setAgendaMsg(null)
    try {
      const meetings = await api.get(`/leagues/${leagueId}/meetings`)
      let draft = meetings.find((m) => m.status === 'draft')
      if (!draft) {
        if (!window.confirm('No draft board meeting yet. Create one and add this item?')) return
        draft = await api.post(`/leagues/${leagueId}/meetings`, { title: 'Board Meeting', items: [] })
      }
      // Don't silently add the same step twice — clicking again looked like a
      // no-op, so people clicked repeatedly and quietly duplicated items.
      const full = await api.get(`/leagues/${leagueId}/meetings/${draft.id}`)
      const already = (full.items || []).some((it) => (it.text || '').trim() === text.trim())
      if (already) {
        setAgendaMsg({ kind: 'dup', id: draft.id, label: meetingLabel(draft) })
        return
      }
      await api.post(`/leagues/${leagueId}/meetings/${draft.id}/items`, {
        text, source: 'task-step', roleKey: task.roleKey, taskId: task.id,
      })
      setAgendaMsg({ kind: 'ok', id: draft.id, label: meetingLabel(draft) })
    } catch {
      setAgendaMsg({ kind: 'err' })
    }
  }

  return (
    <div id={`task-${task.id}`} className={'taskitem' + (open ? ' open' : '')}>
      <div className="taskitem-head" onClick={() => hasBody && setOpen((o) => !o)}>
        <span className="expander">{hasBody ? (open ? '▾' : '▸') : ''}</span>
        <input type="checkbox" className="task-check" checked={task.status === 'done'}
          onChange={toggleStatus} onClick={(e) => e.stopPropagation()} />
        <span className="taskitem-title-cell">
          <EditableTitle value={task.title} canEdit={canEdit}
            className={'taskitem-title' + (task.status === 'done' ? ' taskdone' : '')}
            onSave={(title) => save({ title })} />
        </span>
        {steps.length > 0 && <span className="pill step-count">{doneSet.size}/{steps.length}</span>}
        <WeekPicker value={task.dueWeekOfFY} canEdit={canEdit} seasonYear={seasonYear}
          dueDate={task.dueDate} overrideDate={task.dueDateOverride}
          recurrence={task.recurrence} onRecurrence={setRecurrence}
          onSave={(patch) => save(patch)} />
        {task.seriesId && (
          <span className="pill series-pill" title="Part of a repeating series">⟳</span>
        )}
        {canEdit && onDuplicate && (
          <button type="button" className="icon-btn" title="Duplicate this task and its steps"
            onClick={(e) => { e.stopPropagation(); onDuplicate(task) }}>⧉</button>
        )}
        {canEdit && onDelete && (
          <button type="button" className="icon-btn danger" title="Archive task (kept as an optional item)"
            onClick={(e) => { e.stopPropagation(); if (window.confirm('Archive this task?\n\nIt moves to “Optional / archived” and can be restored in any season.')) onDelete(task) }}>×</button>
        )}
      </div>

      {open && hasBody && (
        <div className="taskitem-body">
          {/* One description field. There used to be a short `description` above
              this as well; the two were merged into `details`. */}
          <DetailsBlock value={task.details} canEdit={canEdit} onSave={(details) => save({ details })} />

          {canEdit && roles.length > 0 && (
            <div className="row task-role-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <label style={{ margin: 0 }} htmlFor={`role-${task.id}`}>Role</label>
              <select id={`role-${task.id}`} value={task.roleKey} style={{ flex: '0 1 240px', minWidth: 0 }}
                onChange={async (e) => {
                  await save({ roleKey: e.target.value })
                  onSeriesChanged?.()   // it may no longer belong in the list being viewed
                }}>
                {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </div>
          )}

          {(steps.length > 0 || canEdit) && (
            <div className="checklist">
              <div className="checklist-head">
                Steps
                {canEdit && <button type="button" className="icon-btn add" title="Add a step" onClick={addStep}>+</button>}
                {seriesMsg && <span className="agenda-msg">{seriesMsg}</span>}
                {agendaMsg && (
                  <span className="agenda-msg">
                    {agendaMsg.kind === 'err' ? 'Could not add'
                      : agendaMsg.kind === 'dup' ? 'Already on ' : 'Added to '}
                    {agendaMsg.kind !== 'err' && (
                      <Link to={`/l/${leagueId}/meetings?open=${agendaMsg.id}`}>{agendaMsg.label} →</Link>
                    )}
                  </span>
                )}
              </div>
              {steps.length === 0 && <p className="muted" style={{ margin: '4px 0' }}>No steps yet — use + to add one.</p>}
              {steps.map((s, i) => (
                <div key={i}
                  className={'checkstep' + (doneSet.has(i) ? ' done' : '') + (overStep === i ? ' dragover' : '')}
                  onDragOver={(e) => { if (canEdit && dragFrom.current != null) { e.preventDefault(); setOverStep(i) } }}
                  onDragLeave={() => setOverStep((v) => (v === i ? null : v))}
                  onDrop={(e) => { e.preventDefault(); moveStep(dragFrom.current, i) }}>
                  {canEdit && (
                    <span className="drag-handle" title="Drag to reorder" draggable
                      onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move' }}
                      onDragEnd={() => { dragFrom.current = null; setOverStep(null) }}>☰</span>
                  )}
                  <input type="checkbox" checked={doneSet.has(i)} onChange={() => toggleStep(i)} />
                  <span className="checkstep-text">
                    <EditableText value={s} canEdit={canEdit} multiline pencil
                      placeholder="Describe this step…" onSave={(t) => setStep(i, t)} />
                  </span>
                  {canEdit && (
                    <span className="checkstep-actions">
                      <button type="button" className="icon-btn" title="Add this step to the board meeting agenda"
                        onClick={() => addToAgenda(s)}>+ agenda</button>
                      <button type="button" className="icon-btn" title="Duplicate this step"
                        onClick={() => duplicateStep(i)}>⧉</button>
                      <button type="button" className="icon-btn danger" title="Archive step (kept as an optional item)"
                        onClick={() => deleteStep(i)}>×</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {(links.length > 0 || canEdit) && (
            <div className="task-links">
              <div className="checklist-head">
                Linked resources
                {canEdit && <button type="button" className="icon-btn add" title="Add a link"
                  onClick={() => setShowLinkPicker(true)}>+</button>}
              </div>
              {links.map((l, i) => (
                <span key={i} className={'linkchip ' + l.type} title={l.ref}>
                  <span className="linkchip-body" onClick={() => openLink(l)}>
                    <span className="linkchip-ic">{LINK_ICON[l.type] || '🔗'}</span> {l.label || l.ref}
                  </span>
                  {canEdit && <button type="button" className="linkchip-x" title="Remove link"
                    onClick={(e) => { e.stopPropagation(); removeLink(i) }}>×</button>}
                </span>
              ))}
              {links.length === 0 && <p className="muted" style={{ margin: '4px 0' }}>No links yet — use + to add one.</p>}
            </div>
          )}
        </div>
      )}

      {showLinkPicker && (
        <LinkPicker leagueId={leagueId} onClose={() => setShowLinkPicker(false)} onAdd={addLink} />
      )}
    </div>
  )
}
