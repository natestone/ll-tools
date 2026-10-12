import React, { useEffect, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { MarkdownDoc } from '../components/Markdown.jsx'
import { EditableText } from '../components/Editable.jsx'
import AgendaWizard from '../components/AgendaWizard.jsx'
import { DateField } from '../components/DateField.jsx'

const RESULTS = [['', '—'], ['carried', 'Carried'], ['failed', 'Failed'], ['tabled', 'Tabled']]
const emptyMotion = () => ({ text: '', movedBy: '', secondedBy: '', result: '' })
const dateLabel = (d) => (d ? new Date(d).toLocaleDateString() : 'No date')

function toMarkdown(m) {
  const L = [`# ${m.title}`, '']
  if (m.meetingDate) L.push(`- **Date:** ${new Date(m.meetingDate).toLocaleDateString()}${m.startTime ? ` — ${m.startTime}` : ''}`)
  if (m.location) L.push(`- **Location:** ${m.location}`)
  if (m.facilitator) L.push(`- **Facilitator:** ${m.facilitator}`)
  if (m.recorder) L.push(`- **Recorder:** ${m.recorder}`)
  if (m.attendees) L.push(`- **Attendees:** ${m.attendees}`)
  L.push('', '## Agenda', '')
  ;(m.items || []).forEach((it, i) => {
    L.push(`${i + 1}. [${it.done ? 'x' : ' '}] ${it.text}`)
    if (it.notes?.trim()) it.notes.trim().split('\n').forEach((line) => L.push(`   ${line}`))
  })
  const motions = (m.items || []).filter((it) => it.motion && (it.motion.text || it.motion.result))
  if (motions.length) {
    L.push('', '## Motions & Votes', '')
    motions.forEach((it) => {
      const mo = it.motion
      L.push(`- **${mo.text || it.text}**`)
      const who = [mo.movedBy && `moved by ${mo.movedBy}`, mo.secondedBy && `seconded by ${mo.secondedBy}`].filter(Boolean).join(', ')
      if (who) L.push(`  - ${who}`)
      if (mo.result) L.push(`  - **Result:** ${mo.result}`)
    })
  }
  return L.join('\n')
}

/* Live minutes for one agenda item: free notes + a structured motion. */
function ItemMinutes({ item, canEdit, onSave }) {
  const [notes, setNotes] = useState(item.notes || '')
  const [m, setM] = useState(item.motion || emptyMotion())
  useEffect(() => {
    setNotes(item.notes || '')
    setM(item.motion || emptyMotion())
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const commitMotion = (next) => { setM(next); onSave({ motion: next }) }
  // basis 180 keeps all three on one line on desktop (identical widths to before)
  // and forces each onto its own full-width line once the row can't hold them.
  const field = (key, label) => (
    <div className="motion-field" style={{ flex: '1 1 180px', minWidth: 0 }}>
      <label>{label}</label>
      <input value={m[key]} disabled={!canEdit}
        onChange={(e) => setM({ ...m, [key]: e.target.value })}
        onBlur={() => { if ((item.motion || emptyMotion())[key] !== m[key]) onSave({ motion: m }) }} />
    </div>
  )

  return (
    <div className="agenda-minutes">
      <div className="checklist-head">Notes</div>
      <textarea rows={3} value={notes} disabled={!canEdit} placeholder="What was discussed…"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => { if (notes !== (item.notes || '')) onSave({ notes }) }} />

      <div className="checklist-head" style={{ marginTop: 12 }}>Motion</div>
      <input value={m.text} disabled={!canEdit} placeholder="Motion as stated…"
        onChange={(e) => setM({ ...m, text: e.target.value })}
        onBlur={() => { if ((item.motion || emptyMotion()).text !== m.text) onSave({ motion: m }) }} />
      <div className="row motion-fields" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {field('movedBy', 'Moved by')}
        {field('secondedBy', 'Seconded by')}
        <div className="motion-field motion-result" style={{ flex: '1 1 150px', maxWidth: 150 }}>
          <label>Result</label>
          <select value={m.result} disabled={!canEdit}
            onChange={(e) => commitMotion({ ...m, result: e.target.value })}>
            {RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}

export default function Meetings() {
  const { leagueId, seasonYear } = useOutletContext()
  const [list, setList] = useState([])
  const [templates, setTemplates] = useState([])
  const [tpl, setTpl] = useState(null)
  const [sel, setSel] = useState(null)
  const [wizard, setWizard] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [openItems, setOpenItems] = useState({})
  const dragFrom = useRef(null)
  const [overIdx, setOverIdx] = useState(null)

  const [params, setParams] = useSearchParams()
  const loadList = () => api.get(`/leagues/${leagueId}/meetings`).then(setList)
  useEffect(() => {
    loadList()
    api.get(`/leagues/${leagueId}/agenda-templates`).then(setTemplates).catch(() => setTemplates([]))
  }, [leagueId])

  const open = (m) => api.get(`/leagues/${leagueId}/meetings/${m.id}`).then(setSel)

  // Deep link from a task step's "+ agenda" confirmation: /meetings?open=<id>
  // opens that meeting directly instead of dropping you on the list.
  useEffect(() => {
    const want = parseInt(params.get('open'), 10)
    if (!Number.isInteger(want) || sel?.id === want) return
    api.get(`/leagues/${leagueId}/meetings/${want}`).then(setSel).catch(() => {})
  }, [params, leagueId]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (patch) => setSel(await api.patch(`/leagues/${leagueId}/meetings/${sel.id}`, patch))
  const canEdit = !!sel?.canEdit
  const items = sel?.items || []

  const setItem = (i, patch) => save({ items: items.map((x, k) => (k === i ? { ...x, ...patch } : x)) })
  const delItem = (i) => save({ items: items.filter((_, k) => k !== i) })
  const addItem = () => {
    if (!newItem.trim()) return
    save({ items: [...items, { text: newItem.trim(), source: 'custom', done: false }] })
    setNewItem('')
  }
  function onDrop(toIdx) {
    const from = dragFrom.current
    dragFrom.current = null; setOverIdx(null)
    if (from == null || from === toIdx) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(toIdx, 0, moved)
    save({ items: next })
  }

  function exportMd() {
    const blob = new Blob([toMarkdown(sel)], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(sel.title || 'meeting').replace(/[^\w-]+/g, '_')}.md`
    a.click(); URL.revokeObjectURL(a.href)
  }
  async function removeMeeting() {
    if (!window.confirm('Delete this meeting?')) return
    await api.del(`/leagues/${leagueId}/meetings/${sel.id}`)
    setSel(null); loadList()
  }

  // ---------- meeting detail ----------
  if (sel) {
    return (
      <div>
        <a href="#" onClick={(e) => { e.preventDefault(); setSel(null); setParams({}, { replace: true }); loadList() }}>← All board meetings</a>
        <h1 style={{ marginTop: 10 }}>
          <EditableText value={sel.title} canEdit={canEdit} pencil onSave={(title) => save({ title })} />
        </h1>

        <div className="card">
          <div className="section-head" style={{ flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Details</h2>
            {/* basis 300 + grow: right-aligned on the same line on desktop, drops to
                its own full-width line (and wraps internally) on a phone */}
            <span className="row meeting-actions"
              style={{ gap: 8, flex: '1 1 300px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <span className="badge">{sel.status}</span>
              {canEdit && (
                <button type="button" className="secondary"
                  onClick={() => save({ status: sel.status === 'held' ? 'draft' : 'held' })}>
                  Mark {sel.status === 'held' ? 'draft' : 'held'}
                </button>
              )}
              <button type="button" className="secondary" onClick={exportMd}>Export Markdown</button>
              {canEdit && <button type="button" className="icon-btn danger" title="Delete meeting" onClick={removeMeeting}>×</button>}
            </span>
          </div>
          <table>
            <tbody>
              {[['Date', 'meetingDate'], ['Start time', 'startTime'], ['Location', 'location'],
                ['Facilitator', 'facilitator'], ['Recorder', 'recorder'], ['Attendees', 'attendees']].map(([lbl, f]) => (
                <tr key={f}>
                  <th className="detail-label" style={{ width: 130 }}>{lbl}</th>
                  <td>
                    {f === 'meetingDate' ? (
                      canEdit
                        ? <DateField style={{ maxWidth: 200 }}
                            value={sel.meetingDate ? String(sel.meetingDate).slice(0, 10) : ''}
                            onChange={(v) => save({ meetingDate: v || null })} />
                        : dateLabel(sel.meetingDate)
                    ) : (
                      <EditableText value={sel[f] || ''} canEdit={canEdit} pencil
                        placeholder="Click to add…" onSave={(v) => save({ [f]: v })} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Agenda ({items.filter((i) => i.done).length}/{items.length})</h2>
          {canEdit && items.length > 1 && <p className="muted" style={{ marginTop: -6 }}>Drag ☰ to reorder. Click ▸ to record notes &amp; motions.</p>}
          {items.length === 0 && <p className="muted">No agenda items yet.</p>}

          {items.map((it, i) => {
            const isOpen = !!openItems[it.id || i]
            const mo = it.motion
            return (
              <div key={it.id || i}
                className={'agenda-item' + (isOpen ? ' open' : '') + (overIdx === i ? ' dragover' : '')}
                onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOverIdx(i) } }}
                onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
                onDrop={(e) => { e.preventDefault(); onDrop(i) }}>
                <div className="agenda-row">
                  {canEdit && (
                    <span className="drag-handle" title="Drag to reorder" draggable
                      onDragStart={() => { dragFrom.current = i }}
                      onDragEnd={() => { dragFrom.current = null; setOverIdx(null) }}>☰</span>
                  )}
                  <input type="checkbox" checked={!!it.done} disabled={!canEdit}
                    onChange={() => setItem(i, { done: !it.done })} />
                  <span className="expander agenda-exp"
                    onClick={() => setOpenItems((o) => ({ ...o, [it.id || i]: !isOpen }))}>{isOpen ? '▾' : '▸'}</span>
                  <span className={'checkstep-text' + (it.done ? ' taskdone' : '')}>
                    <EditableText value={it.text} canEdit={canEdit} multiline pencil
                      onSave={(text) => setItem(i, { text })} />
                  </span>
                  {mo?.result && <span className={'badge motion-' + mo.result}>motion: {mo.result}</span>}
                  {it.notes?.trim() && !isOpen && <span className="badge">notes</span>}
                  {it.source && it.source !== 'custom' && (
                    <span className="badge">{it.source === 'standing' ? 'standing' : (it.roleKey || '').replace(/_/g, ' ')}</span>
                  )}
                  {canEdit && <button type="button" className="icon-btn danger" title="Remove" onClick={() => delItem(i)}>×</button>}
                </div>
                {isOpen && <ItemMinutes item={it} canEdit={canEdit} onSave={(patch) => setItem(i, patch)} />}
              </div>
            )
          })}

          {canEdit && (
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <input value={newItem} placeholder="Add an agenda item…"
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }} />
              <button type="button" className="secondary" onClick={addItem}>Add</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------- list + templates ----------
  return (
    <div>
      <h1>Board meetings</h1>

      <div className="card">
        <div className="section-head" style={{ flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Meetings</h2>
          <button type="button" onClick={() => setWizard(true)}>Generate agenda</button>
        </div>
        {list.length === 0 && <p className="muted">No meetings yet — use “Generate agenda” to create one.</p>}
        {list.map((m) => (
          <div key={m.id} className="taskitem-head meeting-row" style={{ cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => open(m)}>
            {/* order keeps date + title on the first line and pushes the meta onto the
                second one past .taskitem-head::after (the ≤640px flex line-break);
                on desktop the row never wraps so the visual order is unchanged. */}
            <span className="pill meeting-date" style={{ order: 1, marginLeft: 0, flexShrink: 0 }}>{dateLabel(m.meetingDate)}</span>
            <span className="meeting-title" style={{ order: 1, flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>{m.title}</span>
            <span className="badge" style={{ order: 3 }}>{m.status}</span>
            <span className="pill" style={{ order: 3 }}>{m.itemCount} items</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Board meeting templates</h2>
        {templates.length === 0 && <p className="muted">No agenda templates.</p>}
        {!tpl && templates.map((t) => (
          <div key={t.id} style={{ padding: '4px 0' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setTpl(t) }}>{t.title}</a>
          </div>
        ))}
        {tpl && (
          <>
            <div className="section-head" style={{ flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>{tpl.title}</h3>
              <button type="button" className="secondary" onClick={() => setTpl(null)}>Close</button>
            </div>
            <MarkdownDoc source={tpl.bodyMd} />
          </>
        )}
      </div>

      {wizard && (
        <AgendaWizard leagueId={leagueId} seasonYear={seasonYear} onClose={() => setWizard(false)}
          onCreated={(m) => { setWizard(false); loadList(); setSel(m) }} />
      )}
    </div>
  )
}
