import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api.js'
import { EditableText } from '../components/Editable.jsx'

const FIELDS = [
  ['name', 'League name'],
  ['website', 'Website'],
  ['contactEmail', 'Contact email'],
  ['contactPhone', 'Contact phone'],
  ['addressLine1', 'Address'],
  ['city', 'City'],
  ['state', 'State'],
  ['postalCode', 'ZIP / postal code'],
  ['timezone', 'Timezone'],
]

export default function LeagueSettings() {
  const { leagueId, refreshLeague } = useOutletContext()
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { api.get(`/leagues/${leagueId}/settings`).then(setS) }, [leagueId])
  if (!s) return <p>Loading…</p>

  async function save(field, value) {
    setErr('')
    try {
      setS(await api.patch(`/leagues/${leagueId}`, { [field]: value }))
      if (field === 'name') refreshLeague?.()
    } catch (e) { setErr(e.message || 'Could not save') }
  }

  return (
    <div>
      <h1>League settings</h1>
      {err && <p className="err">{err}</p>}
      <div className="card">
        <h2>League information</h2>
        {!s.canEdit && <p className="muted">Only the league owner can edit these.</p>}
        <table className="kv-table settings-table">
          <tbody>
            {FIELDS.map(([f, label]) => (
              <tr key={f}>
                <th className="kv-label">{label}</th>
                <td className="kv-value">
                  <EditableText value={s[f] || ''} canEdit={!!s.canEdit} pencil
                    placeholder="Click to add…" onSave={(v) => save(f, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {s.canEdit && <EmailDelivery leagueId={leagueId} />}
      {s.canEdit && <SeasonRollover />}
    </div>
  )
}

/* Season rollover.

   Lives here, not in the sidebar. It used to sit under the nav where a stray click
   copied 132 tasks into a new season and silently moved the whole league onto it —
   easy to do by accident and confusing to undo. Behind a typed confirmation now,
   because it is a bulk write people should mean. */
function SeasonRollover() {
  const { leagueId, seasons, reloadSeasons, setSeasonYear } = useOutletContext()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  if (!seasons) return null

  const from = seasons.activeSeasonYear
  const to = (from ?? 0) + 1
  const label = (y) => `${y}\u2013${String(y + 1).slice(2)}`

  async function run() {
    setErr(''); setMsg('')
    const typed = window.prompt(
      `This copies every task into ${label(to)} with progress reset, and makes ${label(to)} `
      + `the league's active season. ${label(from)} keeps its own history.\n\n`
      + `Type ${to} to confirm.`)
    if (typed === null) return
    if (String(typed).trim() !== String(to)) { setErr(`Not rolled over — you typed "${typed}", expected ${to}.`); return }
    setBusy(true)
    try {
      const r = await api.post(`/leagues/${leagueId}/seasons/rollover`, {})
      await reloadSeasons?.()
      setSeasonYear?.(r.toYear)
      setMsg(`Rolled over into ${label(r.toYear)}: ${r.active} active tasks copied${r.archived ? `, ${r.archived} optional` : ''}.`)
    } catch (e) { setErr(e.message || 'Rollover failed') } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h2>Season rollover</h2>
      <p className="muted">
        The league is currently on <strong>{label(from)}</strong>. Rolling over copies every
        task into <strong>{label(to)}</strong> with completion reset, carries archived items
        across as optional, and switches the league to the new season. Previous seasons keep
        their own history and stay available in the year picker.
      </p>
      <button type="button" className="secondary" onClick={run} disabled={busy}>
        {busy ? 'Rolling over…' : `Roll over to ${label(to)}`}
      </button>
      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
      {err && <p className="err" style={{ marginTop: 12 }}>{err}</p>}
    </div>
  )
}

/* Owner tool: "my treasurer says she stopped getting emails."

   Exact-match lookup only — the API refuses partial searches and never returns a
   listing, so an owner can fix one person without being handed every address that
   ever unsubscribed across the platform. Super admins get the full list. */
function EmailDelivery({ leagueId }) {
  const [email, setEmail] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function look(e) {
    e.preventDefault(); setErr(''); setResult(null); setBusy(true)
    try { setResult(await api.get(`/leagues/${leagueId}/suppression?email=${encodeURIComponent(email)}`)) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function restore() {
    setErr(''); setBusy(true)
    try {
      await api.del(`/leagues/${leagueId}/suppression`, { email: result.email })
      setResult({ ...result, suppressed: false, restored: true })
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h2>Email delivery</h2>
      <p className="muted">
        If someone says they've stopped receiving league emails, they may have unsubscribed.
        Look up their address to check, and restore it with their permission.
      </p>
      <form onSubmit={look} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="email" placeholder="person@example.com" value={email} required
          onChange={(e) => { setEmail(e.target.value); setResult(null) }}
          style={{ flex: '1 1 220px', minWidth: 0 }} />
        <button type="submit" className="secondary" disabled={busy}>Look up</button>
      </form>
      {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}

      {result && (result.restored ? (
        <p style={{ marginTop: 14 }}>
          ✓ <strong style={{ overflowWrap: 'anywhere' }}>{result.email}</strong> will receive emails again.
        </p>
      ) : result.suppressed ? (
        <div style={{ marginTop: 14 }}>
          <p>
            <strong style={{ overflowWrap: 'anywhere' }}>{result.email}</strong> is unsubscribed
            {result.since && ` (since ${new Date(result.since).toLocaleDateString()})`} and is
            receiving no league email.
          </p>
          <button type="button" onClick={restore} disabled={busy}>Restore email for this address</button>
          <p className="muted" style={{ marginTop: 8, fontSize: '0.78rem' }}>
            Only do this if they've asked you to — they opted out deliberately.
          </p>
        </div>
      ) : (
        <p style={{ marginTop: 14 }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{result.email}</strong> is not unsubscribed —
          emails to it are being sent normally.
        </p>
      ))}
    </div>
  )
}
