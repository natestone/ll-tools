import React, { useEffect, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import { api } from '../api.js'

const TABS = [
  { key: 'policy', label: 'Policy' },
  { key: 'reference', label: 'Reference' },
  { key: 'template', label: 'Email template' },
  { key: 'url', label: 'Web link' },
]

// Pick a real league resource (or a URL) to attach to a task.
export default function LinkPicker({ leagueId, onAdd, onClose }) {
  const [tab, setTab] = useState('policy')
  const [opts, setOpts] = useState({ policy: [], reference: [], template: [] })
  const [q, setQ] = useState('')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [lookup, setLookup] = useState({ state: 'idle', note: '' })
  // don't clobber a label the user typed themselves
  const labelTouched = useRef(false)
  const lastLooked = useRef('')

  useEffect(() => {
    Promise.all([
      api.get(`/leagues/${leagueId}/policies`).catch(() => []),
      api.get(`/leagues/${leagueId}/references`).catch(() => []),
      api.get(`/leagues/${leagueId}/email-templates`).catch(() => []),
    ]).then(([p, r, t]) => setOpts({
      policy: p.map((x) => ({ ref: x.slug, label: x.title })),
      reference: r.map((x) => ({ ref: x.slug, label: x.title })),
      template: t.filter((x) => x.key).map((x) => ({ ref: x.key, label: x.subject || x.name })),
    }))
  }, [leagueId])

  /* Pasting a URL asks the server for the page's <title> and drops it into the
     Label field. The browser can't read docs.google.com itself (no CORS headers),
     so the backend fetches it. Debounced, and never blocks adding the link. */
  useEffect(() => {
    const raw = url.trim()
    if (tab !== 'url' || !/^https?:\/\/\S+\.\S+/i.test(raw)) { setLookup({ state: 'idle', note: '' }); return }
    if (raw === lastLooked.current) return
    const t = setTimeout(async () => {
      lastLooked.current = raw
      setLookup({ state: 'loading', note: '' })
      try {
        const r = await api.get(`/leagues/${leagueId}/unfurl?url=${encodeURIComponent(raw)}`)
        if (raw !== url.trim()) return           // a newer edit won the race
        if (r.title) {
          setLookup({ state: 'ok', note: r.site || '' })
          // functional form reads the LIVE label — the closure's copy goes stale
          // if the user starts typing a label while the lookup is in flight
          setLabel((prev) => (labelTouched.current && prev.trim() ? prev : r.title))
        } else {
          setLookup({ state: 'miss', note: r.reason || '' })
        }
      } catch {
        setLookup({ state: 'miss', note: 'could not reach that link' })
      }
    }, 600)
    return () => clearTimeout(t)
  }, [url, tab, leagueId]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = (opts[tab] || []).filter((o) =>
    !q.trim() || (o.label + ' ' + o.ref).toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <Modal title="Add a linked resource" wide onClose={onClose}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} type="button"
            className={'view-btn' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'url' ? (
        <>
          <label>URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <div className="row" style={{ gap: 6, alignItems: 'baseline', minHeight: 20 }}>
            <label style={{ margin: 0 }}>Label</label>
            {lookup.state === 'loading' && <span className="muted unfurl-note">reading the page title…</span>}
            {lookup.state === 'ok' && <span className="muted unfurl-note">✓ from {lookup.note}</span>}
            {lookup.state === 'miss' && lookup.note && <span className="muted unfurl-note">{lookup.note}</span>}
          </div>
          <input value={label} placeholder="What is it?"
            onChange={(e) => { labelTouched.current = true; setLabel(e.target.value) }} />
          <button type="button" style={{ marginTop: 12 }}
            disabled={!url.trim()}
            onClick={() => { onAdd({ type: 'url', ref: url.trim(), label: label.trim() || url.trim() }); onClose() }}>
            Add link
          </button>
        </>
      ) : (
        <>
          <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
          <div className="pick-list">
            {list.length === 0 && <p className="muted">Nothing available.</p>}
            {list.map((o) => (
              <div key={o.ref} className="pick-row"
                onClick={() => { onAdd({ type: tab, ref: o.ref, label: o.label }); onClose() }}>
                <span className="pick-label">{o.label}</span>
                <span className="muted pick-ref">{o.ref}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
