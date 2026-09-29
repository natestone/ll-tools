import React, { useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { api, weekLabel } from '../api.js'
import { MarkdownView } from '../components/Markdown.jsx'

export default function Templates() {
  const { leagueId, seasonYear } = useOutletContext()
  const [list, setList] = useState([])
  const [sel, setSel] = useState(null)
  const [draft, setDraft] = useState({ subject: '', bodyMd: '' })
  const [msg, setMsg] = useState('')
  const [cat, setCat] = useState('')

  const [params] = useSearchParams()
  const load = () => api.get(`/leagues/${leagueId}/email-templates`).then(setList)
  useEffect(() => { load() }, [leagueId])

  // Auto-open a template when arriving from a task link (?open=<key>)
  useEffect(() => {
    const key = params.get('open')
    if (!key || sel) return
    const t = list.find((x) => x.key === key)
    if (t) open(t)
  }, [list, params]) // eslint-disable-line react-hooks/exhaustive-deps

  const [preview, setPreview] = useState(false)
  function open(t) { setSel(t); setDraft({ subject: t.subject, bodyMd: t.bodyMd }); setMsg(''); setPreview(false) }
  async function save() {
    const upd = await api.patch(`/leagues/${leagueId}/email-templates/${sel.id}`, draft)
    setMsg('Saved.'); setList((l) => l.map((x) => (x.id === upd.id ? upd : x))); setSel(upd)
  }
  async function reset() {
    const upd = await api.post(`/leagues/${leagueId}/email-templates/${sel.id}/reset`)
    setDraft({ subject: upd.subject, bodyMd: upd.bodyMd }); setMsg('Reset to GNGRLL default.')
    setList((l) => l.map((x) => (x.id === upd.id ? upd : x))); setSel(upd)
  }

  const byCat = list.reduce((m, t) => ((m[t.category] ??= []).push(t), m), {})
  const cats = Object.keys(byCat).sort()
  const catLabel = (c) => c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  // follows the open template, so arriving via ?open=<key> lands on the right category
  const activeCat = (cat && byCat[cat]) ? cat : (sel?.category || cats[0] || '')

  function pickCat(c) {
    setCat(c)
    const first = byCat[c]?.[0]
    if (first) open(first)   // show something immediately instead of an empty pane
  }

  return (
    <div>
      <h1>Email templates</h1>

      {/* Narrow screens only. The sidebar lists all 64 templates under ~10 category
          headings, which is thousands of pixels of list above the editor once
          .split stacks. Two selects replace it; CSS swaps which one is visible. */}
      <div className="tpl-picker card">
        <label htmlFor="tpl-cat">Category</label>
        <select id="tpl-cat" value={activeCat} onChange={(e) => pickCat(e.target.value)}>
          {cats.map((c) => <option key={c} value={c}>{catLabel(c)} ({byCat[c].length})</option>)}
        </select>
        <label htmlFor="tpl-one">Template</label>
        <select id="tpl-one" value={sel?.id ?? ''}
          onChange={(e) => {
            const t = (byCat[activeCat] || []).find((x) => String(x.id) === e.target.value)
            if (t) open(t)
          }}>
          <option value="" disabled>Choose a template…</option>
          {(byCat[activeCat] || []).map((t) => (
            <option key={t.id} value={t.id}>{t.subject} — {weekLabel(t.weekOfFY, seasonYear)}</option>
          ))}
        </select>
      </div>

      <div className="split">
        <div className="split-side">
          {cats.map((c) => (
            <div className="card" key={c} style={{ padding: 12 }}>
              <h3 style={{ textTransform: 'capitalize' }}>{c.replace(/_/g, ' ')}</h3>
              {byCat[c].map((t) => (
                <div key={t.id} style={{ padding: '3px 0' }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); open(t) }}>{t.subject}</a>
                  <span className="pill" style={{ marginLeft: 6 }}>{weekLabel(t.weekOfFY, seasonYear)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="split-main">
          {!sel ? <div className="card muted">Select a template to view/edit.</div> : (
            <div className="card">
              <div className="row"><span className="badge">{sel.roleKey}</span><span className="pill">{weekLabel(sel.weekOfFY, seasonYear)}</span></div>
              <label>Subject</label>
              <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <label style={{ margin: '12px 0 5px' }}>Body (Markdown, {'{{placeholders}}'})</label>
                <div className="seg" style={{ marginBottom: 2 }}>
                  <button type="button" className={'view-btn' + (!preview ? ' active' : '')} onClick={() => setPreview(false)}>Edit</button>
                  <button type="button" className={'view-btn' + (preview ? ' active' : '')} onClick={() => setPreview(true)}>Preview</button>
                </div>
              </div>
              {preview
                ? <div className="card" style={{ margin: 0, background: '#fbfbfc' }}><MarkdownView source={draft.bodyMd} /></div>
                : <textarea rows={16} value={draft.bodyMd} onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })} />}
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={save}>Save</button>
                {sel.seededFromId && <button className="secondary" onClick={reset}>Reset to default</button>}
                {msg && <span className="muted">{msg}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
