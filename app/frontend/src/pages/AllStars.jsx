import React, { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import QRCode from 'qrcode'
import { api, isoDate } from '../api.js'
import { MarkdownView } from '../components/Markdown.jsx'

/* All-Star administration: levels and their birthdate windows, the consent text
   parents sign, the public link and its QR code, and the voting cutoff. */
const today = () => new Date().toISOString().slice(0, 10)

export default function AllStars() {
  const { leagueId } = useOutletContext()
  const [year, setYear] = useState(new Date().getFullYear())
  const [s, setS] = useState(null)
  const [signups, setSignups] = useState([])
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('setup')
  const [consent, setConsent] = useState('')
  const [preview, setPreview] = useState(false)
  const [lvl, setLvl] = useState({ name: '', bornFrom: '', bornTo: '' })
  const [voters, setVoters] = useState([])
  const [results, setResults] = useState([])
  const [newVoter, setNewVoter] = useState({ name: '', email: '' })
  const [inviteMsg, setInviteMsg] = useState('')
  const qrRef = useRef(null)

  /* Replaces the old tally.xlsx step: the board wants these numbers in a
     spreadsheet to attach to meeting minutes. Built from the rendered
     standings so the file can never disagree with the screen. */
  const exportCsv = (r) => {
    const cell = (v) => {
      const t = String(v ?? '')
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const rows = [['Rank', 'Player', 'Points', 'First-place votes', 'On ballots', 'Tied']]
    r.standings.forEach((st) => rows.push([
      st.unbrokenTie ? `T${st.rank}` : st.rank, st.playerName, st.points, st.firsts, st.ballots,
      st.unbrokenTie ? 'yes' : '',
    ]))
    const csv = rows.map((row) => row.map(cell).join(',')).join('\r\n')
    const name = `allstars-${year}-${r.levelName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const load = async () => {
    const d = await api.get(`/leagues/${leagueId}/all-stars?year=${year}`)
    setS(d); setConsent(d.consentMd)
    setSignups(await api.get(`/leagues/${leagueId}/all-stars/signups?year=${year}`))
    setVoters(await api.get(`/leagues/${leagueId}/all-stars/voters?year=${year}`))
    setResults(await api.get(`/leagues/${leagueId}/all-stars/results?year=${year}`))
  }
  useEffect(() => { load().catch((e) => setErr(e.message)) }, [leagueId, year]) // eslint-disable-line

  const publicUrl = s ? `${window.location.origin}/allstar/${s.publicSlug}` : ''

  useEffect(() => {
    if (!publicUrl || !qrRef.current) return
    QRCode.toCanvas(qrRef.current, publicUrl, { width: 180, margin: 1 }, () => {})
  }, [publicUrl, tab])

  function downloadQr() {
    const a = document.createElement('a')
    a.href = qrRef.current.toDataURL('image/png')
    a.download = `allstar-signup-${year}.png`
    a.click()
  }

  const save = async (patch) => {
    setErr('')
    try { setS({ ...s, ...(await api.patch(`/leagues/${leagueId}/all-stars?year=${year}`, patch)) }) }
    catch (e) { setErr(e.message) }
  }
  async function addLevel(e) {
    e.preventDefault(); setErr('')
    try {
      await api.post(`/leagues/${leagueId}/all-stars/levels?year=${year}`, lvl)
      setLvl({ name: '', bornFrom: '', bornTo: '' }); await load()
    } catch (ex) { setErr(ex.message) }
  }
  async function delLevel(l) {
    setErr('')
    try { await api.del(`/leagues/${leagueId}/all-stars/levels/${l.id}`); await load() }
    catch (ex) {
      if (!window.confirm(`${ex.message}\n\nDelete it anyway and drop those selections?`)) return
      await api.del(`/leagues/${leagueId}/all-stars/levels/${l.id}?force=1`); await load()
    }
  }

  if (!s) return <p>Loading…</p>
  const ro = !s.canManage

  return (
    <div>
      <h1>All-Stars <span className="muted">{year}</span></h1>
      {ro && <p className="muted">You can view this, but only the president or a VP can change it.</p>}
      {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}

      <div className="row auth-tabs" style={{ margin: '12px 0' }}>
        {[['setup', 'Setup'], ['consent', 'Consent form'], ['signups', `Signups (${signups.length})`],
          ['voters', `Voters (${voters.length})`], ['results', 'Results']].map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} style={{ width: 'auto' }}>
          {[...new Set([...(s.years || []), new Date().getFullYear(), new Date().getFullYear() + 1])]
            .sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {tab === 'setup' && (<>
        <div className="card">
          <h2>Levels</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            A player's date of birth decides which levels they may sign up for. Both bounds are inclusive.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Level</th><th>Born on or after</th><th>Born on or before</th><th></th></tr></thead>
              <tbody>
                {s.levels.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{isoDate(l.bornFrom)}</td>
                    <td>{isoDate(l.bornTo)}</td>
                    <td>{!ro && <button type="button" className="icon-btn danger" onClick={() => delLevel(l)}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.levels.length === 0 && <p className="muted">No levels yet.</p>}
          {!ro && (
            <form onSubmit={addLevel} className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <input placeholder="Level name" value={lvl.name} required
                onChange={(e) => setLvl({ ...lvl, name: e.target.value })} style={{ flex: '1 1 160px', minWidth: 0 }} />
              <input type="date" value={lvl.bornFrom} required title="Born on or after"
                onChange={(e) => setLvl({ ...lvl, bornFrom: e.target.value })} style={{ flex: '0 1 165px' }} />
              <input type="date" value={lvl.bornTo} required title="Born on or before"
                onChange={(e) => setLvl({ ...lvl, bornTo: e.target.value })} style={{ flex: '0 1 165px' }} />
              <button type="submit">Add level</button>
            </form>
          )}
        </div>

        <div className="card">
          <h2>Public signup link</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Share this with families. Anyone holding the link can sign up, so treat it as semi-private
            — rotate it if it ends up somewhere public.
          </p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <code className="invite-link" style={{ wordBreak: 'break-all' }}>{publicUrl}</code>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(publicUrl)}>Copy link</button>
                <button type="button" className="secondary" onClick={() => window.open(`/allstar/${s.publicSlug}?preview=1`, '_blank', 'noopener')}>Preview form</button>
                <button type="button" className="secondary" onClick={downloadQr}>Download QR</button>
                {!ro && (
                  <button type="button" className="secondary"
                    onClick={async () => {
                      if (!window.confirm('Rotate the link? The old URL and any printed QR code stop working.')) return
                      await api.post(`/leagues/${leagueId}/all-stars/rotate-link?year=${year}`); await load()
                    }}>Rotate link</button>
                )}
              </div>
            </div>
            <canvas ref={qrRef} style={{ border: '1px solid var(--line)', borderRadius: 8 }} />
          </div>
        </div>

        <div className="card" style={{ maxWidth: 620 }}>
          <h2>Signups & voting</h2>
          <label>Signups</label>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button type="button" className="secondary" disabled={ro}
              onClick={() => save({ signupOpen: !s.signupOpen })}>
              {s.signupOpen ? 'Close signups' : 'Reopen signups'}
            </button>
            <span className={'badge ' + (s.signupOpen ? 'cal-kind-task' : '')}>{s.signupOpen ? 'open' : 'closed'}</span>
          </div>
          <label>Voting closes</label>
          <input type="datetime-local" disabled={ro} style={{ maxWidth: 260 }}
            value={s.votingClosesAt ? new Date(s.votingClosesAt).toISOString().slice(0, 16) : ''}
            onChange={(e) => save({ votingClosesAt: e.target.value || null })} />
          <p className="muted" style={{ fontSize: '0.78rem' }}>
            Coaches can change their ballots until this moment. Shown as a countdown on the ballot page.
          </p>
        </div>
      </>)}

      {tab === 'consent' && (
        <div className="card">
          <div className="section-head">
            <h2 style={{ margin: 0 }}>Consent & agreement</h2>
            <div className="seg">
              <button type="button" className={'view-btn' + (!preview ? ' active' : '')} onClick={() => setPreview(false)}>Edit</button>
              <button type="button" className={'view-btn' + (preview ? ' active' : '')} onClick={() => setPreview(true)}>Preview</button>
            </div>
          </div>
          <p className="muted" style={{ marginTop: -4 }}>
            Markdown. Each signup stores the wording as it stood when the parent signed, so editing
            this never changes what somebody already agreed to.
          </p>
          {preview
            ? <div className="card" style={{ margin: 0, background: '#fbfbfc' }}><MarkdownView source={consent} /></div>
            : <textarea rows={16} value={consent} disabled={ro} onChange={(e) => setConsent(e.target.value)} />}
          {!ro && (
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button type="button" onClick={() => save({ consentMd: consent })}>Save</button>
              <button type="button" className="secondary"
                onClick={() => window.open(`/allstar/${s.publicSlug}?preview=1`, '_blank', 'noopener')}>Open full preview</button>
            </div>
          )}
        </div>
      )}

      {tab === 'voters' && (<>
        <div className="card">
          <h2>Voters</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Each voter gets their own ballot link. Opening it emails them a code, so a forwarded
            link alone can't be used by somebody else. Nothing is sent until you press the button.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Invited</th><th>Progress</th><th></th></tr></thead>
              <tbody>
                {voters.map((v) => (
                  <tr key={v.id}>
                    <td>{v.name}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{v.email}</td>
                    <td>{v.invitedAt ? new Date(v.invitedAt).toLocaleDateString() : <span className="muted">not yet</span>}</td>
                    <td>{v.submitted > 0
                      ? <span className="badge cal-kind-task">{v.submitted} submitted</span>
                      : v.started > 0 ? <span className="badge">opened</span> : <span className="muted">—</span>}</td>
                    <td>{!ro && <button type="button" className="icon-btn danger"
                      onClick={async () => { if (window.confirm(`Remove ${v.name}?`)) { await api.del(`/leagues/${leagueId}/all-stars/voters/${v.id}`); load() } }}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {voters.length === 0 && <p className="muted">No voters yet.</p>}
          {!ro && (
            <form className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}
              onSubmit={async (e) => {
                e.preventDefault(); setErr('')
                try { await api.post(`/leagues/${leagueId}/all-stars/voters?year=${year}`, newVoter); setNewVoter({ name: '', email: '' }); load() }
                catch (ex) { setErr(ex.message) }
              }}>
              <input placeholder="Coach name" value={newVoter.name} required
                onChange={(e) => setNewVoter({ ...newVoter, name: e.target.value })} style={{ flex: '1 1 160px', minWidth: 0 }} />
              <input type="email" placeholder="email@example.com" value={newVoter.email} required
                onChange={(e) => setNewVoter({ ...newVoter, email: e.target.value })} style={{ flex: '1 1 180px', minWidth: 0 }} />
              <button type="submit">Add voter</button>
            </form>
          )}
        </div>

        {!ro && (
          <div className="card" style={{ maxWidth: 620 }}>
            <h2>Send voting invites</h2>
            <p className="muted" style={{ marginTop: -4 }}>
              {s.votingClosesAt
                ? <>Emails each voter their personal ballot link and the cutoff
                    (<strong>{new Date(s.votingClosesAt).toLocaleString()}</strong>).</>
                : <span className="err">Set the voting cutoff on the Setup tab first.</span>}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={!voters.length || !s.votingClosesAt}
                onClick={async () => {
                  if (!window.confirm(`Email a ballot link to ${voters.filter((v) => !v.invitedAt).length} voter(s)?`)) return
                  const r = await api.post(`/leagues/${leagueId}/all-stars/send-invites?year=${year}`)
                  setInviteMsg(r.message || `Sent ${r.sent}.` + (r.failed?.length ? ` ${r.failed.length} failed.` : ''))
                  load()
                }}>Send to the un-invited</button>
              <button type="button" className="secondary" disabled={!voters.length || !s.votingClosesAt}
                onClick={async () => {
                  if (!window.confirm(`Re-send to ALL ${voters.length} voter(s)?`)) return
                  const r = await api.post(`/leagues/${leagueId}/all-stars/send-invites?year=${year}&resend=1`)
                  setInviteMsg(`Sent ${r.sent}.` + (r.failed?.length ? ` ${r.failed.length} failed.` : ''))
                  load()
                }}>Re-send to everyone</button>
            </div>
            {inviteMsg && <p style={{ marginTop: 10 }}>{inviteMsg}</p>}
          </div>
        )}
      </>)}

      {tab === 'results' && (
        <>
          {results.filter((r) => r.candidates > 0).length === 0 && (
            <div className="card"><p className="muted">No candidates yet.</p></div>
          )}
          {results.filter((r) => r.candidates > 0).map((r) => (
            <div className="card" key={r.levelId}>
              <div className="section-head">
                <h2 style={{ margin: 0 }}>{r.levelName}</h2>
                <div className="results-head">
                  <span className="muted">{r.ballotsCast} submitted of {r.ballotsStarted} opened · {r.candidates} candidates</span>
                  <button type="button" className="secondary results-export" onClick={() => exportCsv(r)}
                    disabled={!r.ballotsCast} title="Download these standings as a spreadsheet">Export CSV</button>
                </div>
              </div>
              {r.ballotsCast === 0 && <p className="muted">No ballots submitted yet — standings are all zero.</p>}
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>#</th><th>Player</th><th>Points</th><th>1st-place</th><th>On ballots</th></tr></thead>
                  <tbody>
                    {r.standings.map((st, i) => (
                      <tr key={st.signupId}>
                        <td>{st.unbrokenTie ? `T${st.rank}` : st.rank}</td>
                        <td>
                          {st.playerName}
                          {st.unbrokenTie && <span className="badge" style={{ marginLeft: 8 }}>tied</span>}
                        </td>
                        <td>{st.points}</td><td>{st.firsts}</td><td>{st.ballots}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.standings.some((s) => s.unbrokenTie) && (
                <p className="muted" style={{ marginTop: 10 }}>
                  Players marked <strong>tied</strong> finished on identical points <em>and</em> identical
                  placements — the coaches ranked them the same way. The system won't invent a winner;
                  the board needs to break these.
                </p>
              )}
            </div>
          ))}
          <p className="muted">
            Borda count: with N candidates, a first place is worth N points down to 1 for last.
            Only submitted ballots count. Equal points are separated by who was placed first most often,
            then second, and so on.
          </p>
        </>
      )}

      {tab === 'signups' && (
        <div className="card">
          <h2>Signups</h2>
          {signups.length === 0 && <p className="muted">Nobody has signed up yet.</p>}
          {signups.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Player</th><th>DOB</th><th>Levels</th><th>Signed by</th><th>When</th><th></th></tr></thead>
                <tbody>
                  {signups.map((x) => (
                    <tr key={x.id}>
                      <td>{x.playerName}</td>
                      <td>{isoDate(x.playerDob)}</td>
                      <td>{x.levels.map((l) => <span key={l.id} className="badge">{l.name}</span>)}</td>
                      <td>{x.parentName}{x.parentEmail ? <div className="muted" style={{ fontSize: '.75rem' }}>{x.parentEmail}</div> : null}</td>
                      <td>{new Date(x.signedAt).toLocaleDateString()}</td>
                      <td>{!ro && <button type="button" className="icon-btn danger"
                        onClick={async () => { if (window.confirm(`Remove ${x.playerName}?`)) { await api.del(`/leagues/${leagueId}/all-stars/signups/${x.id}`); load() } }}>×</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
