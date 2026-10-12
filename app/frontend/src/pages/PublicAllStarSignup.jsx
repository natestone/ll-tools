import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { MarkdownView } from '../components/Markdown.jsx'

/* The public All-Star signup form.

   No login: a parent is not a league member. The page is reached by an
   unguessable slug, and the levels on offer are filtered by the date of birth
   the parent types. The server re-checks that eligibility — this filtering is a
   convenience, not the control.

   One form covers a whole family. Siblings share the parent block at the
   bottom, so a parent with three children signs once rather than filling the
   same contact details three times. */
const iso = (d) => (d ? String(d).slice(0, 10) : '')
const blankPlayer = () => ({ key: Math.random().toString(36).slice(2), playerName: '', playerDob: '', levelIds: [] })

export default function PublicAllStarSignup() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const isPreview = params.get('preview') === '1'

  const [data, setData] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [players, setPlayers] = useState([blankPlayer()])
  const [parent, setParent] = useState({ parentName: '', parentEmail: '', parentPhone: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    fetch(`/api/public/allstar/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setLoadErr(d.error) : setData(d)))
      .catch(() => setLoadErr('Could not load this form.'))
  }, [slug])

  const eligibleFor = (dob) => (!data || !dob ? []
    : data.levels.filter((l) => iso(l.bornFrom) <= dob && dob <= iso(l.bornTo)))

  const patch = (i, fields) => setPlayers((ps) => ps.map((p, n) => (n === i ? { ...p, ...fields } : p)))

  // Correcting a date of birth must drop any level it no longer qualifies for,
  // or the browser would post a selection the server will reject.
  const setDob = (i, dob) => setPlayers((ps) => ps.map((p, n) => {
    if (n !== i) return p
    const ok = eligibleFor(dob).map((l) => l.id)
    return { ...p, playerDob: dob, levelIds: p.levelIds.filter((id) => ok.includes(id)) }
  }))

  const toggle = (i, id) => setPlayers((ps) => ps.map((p, n) => (n === i ? {
    ...p, levelIds: p.levelIds.includes(id) ? p.levelIds.filter((x) => x !== id) : [...p.levelIds, id],
  } : p)))

  const addPlayer = () => setPlayers((ps) => [...ps, blankPlayer()])
  const removePlayer = (i) => setPlayers((ps) => ps.filter((_, n) => n !== i))

  const ready = players.length > 0
    && players.every((p) => p.playerName.trim() && p.playerDob && p.levelIds.length)
    && parent.parentName.trim() && parent.parentEmail.trim()

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    if (isPreview) { setErr('This is a preview — submissions are disabled.'); setBusy(false); return }
    try {
      const r = await fetch(`/api/public/allstar/${encodeURIComponent(slug)}/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parent,
          players: players.map(({ playerName, playerDob, levelIds }) => ({ playerName, playerDob, levelIds })),
        }),
      }).then((x) => x.json())
      if (r.error) setErr(r.error)
      else setDone(r)
    } catch { setErr('Could not submit the form.') } finally { setBusy(false) }
  }

  if (loadErr) return <div className="center"><div className="card"><h1>All-Star signup</h1><p className="err">{loadErr}</p></div></div>
  if (!data) return <div className="center card">Loading…</div>

  if (done) return (
    <div className="center">
      <div className="card">
        <h1>Thank you</h1>
        <p>{done.players.length > 1 ? "These players are signed up:" : 'Signed up:'}</p>
        <ul className="signup-recap">
          {done.players.map((p) => (
            <li key={p.playerName}><strong>{p.playerName}</strong> — {p.levels.join(', ')}</li>
          ))}
        </ul>
        {done.emailed
          ? <p className="muted">A confirmation has been emailed to {done.email}.</p>
          : <p className="muted">
              We couldn't email a confirmation to {done.email}, but the signup is recorded.
              Take a screenshot of this page if you'd like a copy.
            </p>}
        <p className="muted">You'll hear from the league about practices and selection.</p>
      </div>
    </div>
  )

  return (
    <div className="signup-page">
      {isPreview && <div className="preview-banner">Preview — submissions are disabled</div>}
      <div className="card">
        <h1>{data.leagueName}</h1>
        <p className="muted" style={{ marginTop: -10 }}>{data.year} All-Star signup</p>

        {!data.signupOpen && <p className="err">Signups for this season are closed.</p>}

        <div className="md consent-box"><MarkdownView source={data.consentMd} /></div>

        <form onSubmit={submit}>
          {players.map((p, i) => {
            const eligible = eligibleFor(p.playerDob)
            return (
              <fieldset className="player-block" key={p.key}>
                <legend>
                  Player {i + 1}
                  {players.length > 1 && (
                    <button type="button" className="icon-btn" title="Remove this player"
                      onClick={() => removePlayer(i)}>×</button>
                  )}
                </legend>

                <label>Player's full name</label>
                <input value={p.playerName} onChange={(e) => patch(i, { playerName: e.target.value })} required />

                <label>Player's date of birth</label>
                <input type="date" value={p.playerDob} onChange={(e) => setDob(i, e.target.value)}
                  required style={{ maxWidth: 220 }} />

                <label>Levels</label>
                {!p.playerDob && <p className="muted">Enter the date of birth to see which levels they're eligible for.</p>}
                {p.playerDob && eligible.length === 0 && (
                  <p className="err">That date of birth isn't eligible for any level this year.</p>
                )}
                {eligible.length > 1 && (
                  <p className="muted" style={{ fontSize: '0.78rem' }}>
                    Pick every level they should be considered for — more than one is fine.
                  </p>
                )}
                <div className="role-toggles">
                  {eligible.map((l) => (
                    <label key={l.id} className={'level-pick' + (p.levelIds.includes(l.id) ? ' on' : '')}>
                      <input type="checkbox" checked={p.levelIds.includes(l.id)} onChange={() => toggle(i, l.id)} />
                      {l.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}

          <div style={{ margin: '4px 0 18px' }}>
            <button type="button" className="secondary" onClick={addPlayer}>+ Add another player</button>
          </div>

          <h2 style={{ fontSize: '1rem' }}>Your details</h2>
          <label>Your email</label>
          <input type="email" value={parent.parentEmail} required
            onChange={(e) => setParent({ ...parent, parentEmail: e.target.value })} />
          <p className="muted" style={{ fontSize: '0.78rem' }}>
            We'll email you a confirmation of {players.length > 1 ? 'these signups' : 'this signup'}.
          </p>

          <label>Your phone (optional)</label>
          <input value={parent.parentPhone} onChange={(e) => setParent({ ...parent, parentPhone: e.target.value })} />

          <label>Type your full name to sign</label>
          <input value={parent.parentName} required
            onChange={(e) => setParent({ ...parent, parentName: e.target.value })}
            placeholder="Parent or guardian name" className="signature-input" />
          <p className="muted" style={{ fontSize: '0.78rem' }}>
            Typing your name above is your electronic signature on the agreement shown here
            {players.length > 1 ? `, for all ${players.length} players listed.` : '.'}
          </p>

          {err && <p className="err">{err}</p>}
          <div style={{ marginTop: 14 }}>
            <button type="submit" disabled={busy || !data.signupOpen || !ready}>
              {busy ? 'Submitting…' : `Sign and submit${players.length > 1 ? ` (${players.length} players)` : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
