import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Sortable from 'sortablejs'

/* A coach's All-Star ballot.

   Two factors: the link in their email identifies them, a code sent to that
   address proves it is them. The session key from /verify is kept in
   sessionStorage — not localStorage — so a shared machine does not leave a
   voting session open for the next person.

   Ordering is saved on every drop; there is no "save" step to forget. */
const pad = (n) => String(n).padStart(2, '0')

function Countdown({ closesAt }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((v) => v + 1), 1000); return () => clearInterval(t) }, [])
  if (!closesAt) return null
  const ms = new Date(closesAt) - new Date()
  if (ms <= 0) return <span className="countdown closed">Voting has closed</span>
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24
  const m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60
  return (
    <span className="countdown">
      {d > 0 && <>{d}d </>}{pad(h)}:{pad(m)}:{pad(s)} left
    </span>
  )
}

function LevelBallot({ level, onSave, disabled }) {
  const listRef = useRef(null)
  const [rows, setRows] = useState(level.ranking)
  const [state, setState] = useState('')

  useEffect(() => { setRows(level.ranking) }, [level.ranking])
  useEffect(() => {
    if (!listRef.current || disabled) return
    const s = Sortable.create(listRef.current, {
      handle: '.ballot-handle', animation: 150, ghostClass: 'ballot-ghost',
      onEnd: async () => {
        const ids = [...listRef.current.children].map((li) => Number(li.dataset.id))
        setRows((r) => ids.map((id) => r.find((x) => x.id === id)))
        setState('saving')
        try { await onSave(ids); setState('saved'); setTimeout(() => setState(''), 1800) }
        catch (e) { setState(e.message || 'could not save') }
      },
    })
    return () => s.destroy()
  }, [disabled, onSave])

  if (!level.ranking.length) return null
  return (
    <div className="card">
      <div className="section-head">
        <h2 style={{ margin: 0 }}>{level.levelName}</h2>
        <span className="muted">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : state || (level.submittedAt ? 'Submitted' : 'Not submitted')}
        </span>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>Best at the top. Drag to reorder — changes save as you go.</p>
      <ol className="ballot" ref={listRef}>
        {rows.map((p, i) => (
          <li key={p.id} data-id={p.id} className="ballot-row">
            <span className="ballot-rank">{i + 1}</span>
            <span className="ballot-name">{p.name}</span>
            {!disabled && <span className="ballot-handle" title="Drag to reorder">☰</span>}
          </li>
        ))}
      </ol>
      {!disabled && (
        <button type="button" className="secondary" style={{ marginTop: 10 }}
          onClick={async () => { await onSave(rows.map((r) => r.id), true); setState('saved') }}>
          {level.submittedAt ? 'Re-submit this level' : 'Submit this level'}
        </button>
      )}
    </div>
  )
}

export default function PublicBallot() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [key, setKey] = useState(() => sessionStorage.getItem(`ballot:${token}`) || '')
  const [data, setData] = useState(null)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const call = (path, opts = {}) => fetch(`/api/public/vote/${encodeURIComponent(token)}${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-ballot-key': key } : {}), ...opts.headers },
  }).then((r) => r.json())

  useEffect(() => { call('').then((d) => (d.error ? setErr(d.error) : setInfo(d))) }, [token]) // eslint-disable-line
  useEffect(() => {
    if (!key || !info || info.closed) return
    call('/ballots').then((d) => {
      if (d.error) { setKey(''); sessionStorage.removeItem(`ballot:${token}`) } else setData(d)
    })
  }, [key, info]) // eslint-disable-line

  async function requestCode() {
    setErr(''); setBusy(true)
    const r = await call('/request-code', { method: 'POST' })
    if (r.error) setErr(r.error); else setSent(r.sentTo)
    setBusy(false)
  }
  async function verify(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    const r = await call('/verify', { method: 'POST', body: JSON.stringify({ code }) })
    if (r.error) setErr(r.error)
    else { sessionStorage.setItem(`ballot:${token}`, r.key); setKey(r.key) }
    setBusy(false)
  }
  const saveLevel = async (levelId, ordering, submit) => {
    const r = await call(`/ballot/${levelId}`, { method: 'PUT', body: JSON.stringify({ ordering, submit }) })
    if (r.error) throw new Error(r.error)
    if (submit) setData(await call('/ballots'))
    return r
  }

  if (err && !info) return <div className="center"><div className="card"><h1>Ballot</h1><p className="err">{err}</p></div></div>
  if (!info) return <div className="center card">Loading…</div>

  return (
    <div className="signup-page">
      <div className="card">
        <h1>{info.leagueName}</h1>
        <p className="muted" style={{ marginTop: -10 }}>
          {info.year} All-Star ballot · {info.voterName} · <Countdown closesAt={info.votingClosesAt} />
        </p>
        {info.closed && <p className="err">Voting has closed. Ballots are final.</p>}
      </div>

      {!key && !info.closed && (
        <div className="card">
          <h2>Confirm it's you</h2>
          <p className="muted">
            Your link is personal. We'll email a 6-digit code to <strong>{info.maskedEmail}</strong> to confirm.
          </p>
          {!sent
            ? <button type="button" onClick={requestCode} disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
            : (
              <form onSubmit={verify}>
                <p className="muted">Code sent to {sent}.</p>
                <label>6-digit code</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
                  maxLength={6} style={{ maxWidth: 160, letterSpacing: 6, fontSize: '1.2rem' }} required />
                <div className="row" style={{ marginTop: 12, gap: 8 }}>
                  <button type="submit" disabled={busy}>Confirm</button>
                  <button type="button" className="secondary" onClick={requestCode}>Resend</button>
                </div>
              </form>
            )}
          {err && <p className="err">{err}</p>}
        </div>
      )}

      {key && data && data.ballots.map((b) => (
        <LevelBallot key={b.levelId} level={b} disabled={data.closed}
          onSave={(ids, submit) => saveLevel(b.levelId, ids, submit)} />
      ))}
      {key && data && !data.ballots.some((b) => b.ranking.length) && (
        <div className="card"><p className="muted">No players have signed up yet.</p></div>
      )}
    </div>
  )
}
