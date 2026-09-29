import React, { useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { MarkdownDoc } from '../components/Markdown.jsx'

export default function Policies() {
  const { leagueId } = useOutletContext()
  const [policies, setPolicies] = useState([])
  const [refs, setRefs] = useState([])
  const [sel, setSel] = useState(null)   // { kind:'policy'|'ref', doc }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', bodyMd: '' })
  const [msg, setMsg] = useState('')

  const [params] = useSearchParams()
  const loadLists = () => {
    api.get(`/leagues/${leagueId}/policies`).then(setPolicies)
    api.get(`/leagues/${leagueId}/references`).then(setRefs)
  }
  useEffect(() => { loadLists() }, [leagueId])

  // Auto-open a policy/reference when arriving from a task link (?open=slug)
  useEffect(() => {
    const slug = params.get('open')
    if (!slug || sel) return
    if (policies.some((p) => p.slug === slug)) openPolicy(slug)
    else { const r = refs.find((x) => x.slug === slug); if (r) open('ref', r) }
  }, [policies, refs, params]) // eslint-disable-line react-hooks/exhaustive-deps

  function open(kind, doc) { setSel({ kind, doc }); setEditing(false); setMsg('') }
  function openPolicy(slug) { api.get(`/leagues/${leagueId}/policies/${slug}`).then((doc) => open('policy', doc)) }

  function startEdit() {
    setDraft({ title: sel.doc.title, bodyMd: sel.doc.bodyMd }); setEditing(true); setMsg('')
  }
  async function save() {
    const base = sel.kind === 'policy' ? 'policies' : 'references'
    const updated = await api.patch(`/leagues/${leagueId}/${base}/${sel.doc.slug}`, draft)
    setSel({ kind: sel.kind, doc: updated }); setEditing(false); setMsg('Saved.'); loadLists()
  }

  return (
    <div>
      <h1>Policies &amp; documents</h1>
      <div className="split">
        <div className="split-side">
          <div className="card">
            <h3>Policies</h3>
            {policies.map((p) => (<div key={p.id} style={{ padding: '3px 0' }}>
              <a href="#" onClick={(e) => { e.preventDefault(); openPolicy(p.slug) }}>{p.title}</a></div>))}
          </div>
          <div className="card">
            <h3>Reference</h3>
            {refs.map((r) => (<div key={r.id} style={{ padding: '3px 0' }}>
              <a href="#" onClick={(e) => { e.preventDefault(); open('ref', r) }}>{r.title}</a></div>))}
          </div>
        </div>
        <div className="split-main">
          {!sel ? <div className="card muted">Select a document.</div> : (
            <div className="card">
              {editing ? (
                <>
                  <label>Title</label>
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  <label>Body (Markdown)</label>
                  <textarea rows={22} value={draft.bodyMd} onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })} />
                  <div className="row" style={{ marginTop: 10 }}>
                    <button onClick={save}>Save</button>
                    <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <h2 style={{ marginBottom: 4 }}>{sel.doc.title}</h2>
                  {msg && <span className="muted">{msg}</span>}
                  <MarkdownDoc
                    source={sel.doc.bodyMd}
                    actions={sel.doc.canEdit ? <button className="secondary" onClick={startEdit}>Edit</button> : null}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
