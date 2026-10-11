import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { MarkdownView } from '../components/Markdown.jsx'

/* The public All-Star signup form.

   No login: a parent is not a league member. The page is reached by an
   unguessable slug, and the levels on offer are filtered by the date of birth
   the parent types. The server re-checks that eligibility — this filtering is a
   convenience, not the control. */
const iso = (d) => (d ? String(d).slice(0, 10) : '')

export default function PublicAllStarSignup() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const isPreview = params.get('preview') === '1'

  const [data, setData] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [form, setForm] = useState({ playerName: '', playerDob: '', parentName: '', parentEmail: '', parentPhone: '' })
  const [levelIds, setLevelIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    fetch(`/api/public/allstar/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setLoadErr(d.error) : setData(d)))
      .catch(() => setLoadErr('Could not load this form.'))
  }, [slug])

  // Which levels the typed date of birth qualifies for.
  const eligible = useMemo(() => {
    if (!data || !form.playerDob) return []
    return data.levels.filter((l) => iso(l.bornFrom) <= form.playerDob && form.playerDob <= iso(l.bornTo))
  }, [data, form.playerDob])

  // Drop any selection that stops being eligible when the date is corrected.
  useEffect(() => {
    setLevelIds((ids) => ids.filter((id) => eligible.some((l) => l.id === id)))
  }, [eligible])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const toggle = (id) => setLevelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    if (isPreview) { setErr('This is a preview — submissions are disabled.'); setBusy(false); return }
    try {
      const r = await fetch(`/api/public/allstar/${encodeURIComponent(slug)}/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, levelIds }),
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
        <p><strong>{done.playerName}</strong> is signed up for: {done.levels.join(', ')}.</p>
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
          <label>Player's full name</label>
          <input value={form.playerName} onChange={set('playerName')} required />

          <label>Player's date of birth</label>
          <input type="date" value={form.playerDob} onChange={set('playerDob')} required style={{ maxWidth: 220 }} />

          <label>Levels</label>
          {!form.playerDob && <p className="muted">Enter the date of birth to see which levels they're eligible for.</p>}
          {form.playerDob && eligible.length === 0 && (
            <p className="err">That date of birth isn't eligible for any level this year.</p>
          )}
          <div className="role-toggles">
            {eligible.map((l) => (
              <label key={l.id} className={'level-pick' + (levelIds.includes(l.id) ? ' on' : '')}>
                <input type="checkbox" checked={levelIds.includes(l.id)} onChange={() => toggle(l.id)} />
                {l.name}
              </label>
            ))}
          </div>

          <label>Your email (optional)</label>
          <input type="email" value={form.parentEmail} onChange={set('parentEmail')} />
          <label>Your phone (optional)</label>
          <input value={form.parentPhone} onChange={set('parentPhone')} />

          <label>Type your full name to sign</label>
          <input value={form.parentName} onChange={set('parentName')} required
            placeholder="Parent or guardian name" className="signature-input" />
          <p className="muted" style={{ fontSize: '0.78rem' }}>
            Typing your name above is your electronic signature on the agreement shown here.
          </p>

          {err && <p className="err">{err}</p>}
          <div style={{ marginTop: 14 }}>
            <button type="submit" disabled={busy || !data.signupOpen || !levelIds.length}>
              {busy ? 'Submitting…' : 'Sign and submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
