import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'

/* Platform-operator console. The API 404s every /admin route for non-admins, so
   this page is a convenience, not the security boundary. */
export default function SuperAdmin() {
  const { user } = useAuth()
  const [tab, setTab] = useState('leagues')
  const [overview, setOverview] = useState(null)
  const [leagues, setLeagues] = useState([])
  const [admins, setAdmins] = useState([])
  const [sup, setSup] = useState([])
  const [supQ, setSupQ] = useState('')
  const [form, setForm] = useState({ name: '', ownerEmail: '' })
  const [adminEmail, setAdminEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState('')

  const load = () => Promise.all([
    api.get('/admin/overview').then(setOverview),
    api.get('/admin/leagues').then(setLeagues),
    api.get('/admin/admins').then(setAdmins),
    api.get('/admin/suppressions').then(setSup),
  ]).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  async function createLeague(e) {
    e.preventDefault(); setErr(''); setMsg(null); setBusy(true)
    try {
      const r = await api.post('/admin/leagues', form)
      setMsg(r); setForm({ name: '', ownerEmail: '' }); await load()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function searchSup(e) {
    e?.preventDefault()
    setSup(await api.get(`/admin/suppressions?q=${encodeURIComponent(supQ)}`))
  }
  async function restore(email) {
    await api.del('/admin/suppressions', { email })
    await searchSup(); await load()
  }
  async function promote(e) {
    e.preventDefault(); setErr('')
    try { await api.post('/admin/admins', { email: adminEmail }); setAdminEmail(''); await load() }
    catch (ex) { setErr(ex.message) }
  }
  async function demote(id) {
    setErr('')
    try { await api.del(`/admin/admins/${id}`); await load() } catch (ex) { setErr(ex.message) }
  }

  if (!user?.isSuperAdmin) {
    return <div className="center card"><h1>Not found</h1><p><Link to="/">Go to your leagues</Link></p></div>
  }

  const TABS = [['leagues', 'Organizations'], ['email', 'Email suppression'], ['admins', 'Super admins']]

  return (
    <div>
      <div className="topbar">
        <span className="brand">GNGRLL</span>
        <span className="pill">Super admin</span>
        <span style={{ flex: 1 }} />
        <Link to="/">My leagues</Link>
      </div>
      <div className="content">
        <h1>Platform administration</h1>
        {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}

        {overview && (
          <div className="grid cols2" style={{ marginBottom: 8 }}>
            <div className="card accent"><h3>Organizations</h3><div className="bignum">{overview.leagues}</div></div>
            <div className="card accent"><h3>Users</h3><div className="bignum">{overview.users}</div></div>
            <div className="card accent"><h3>Unsubscribed</h3><div className="bignum">{overview.suppressed}</div></div>
          </div>
        )}

        {/* The template itself. Opening it is just the normal league UI pointed at
            the seed org, so everything is edited the same way it is anywhere else. */}
        {overview?.seed && (
          <div className="card" style={{ borderLeft: '4px solid var(--navy)' }}>
            <div className="section-head">
              <h2 style={{ margin: 0 }}>{overview.seed.name}</h2>
              <Link to={`/l/${overview.seed.id}`}><button type="button">Edit the template</button></Link>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Every new organization is cloned from this one. Changes here apply to
              organizations created <strong>afterwards</strong> — existing ones keep their own copies.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="pill">{overview.seed.tasks} tasks</span>
              <span className="pill">{overview.seed.emailTemplates} email templates</span>
              <span className="pill">{overview.seed.calendarItems} calendar items</span>
              <span className="pill">{overview.seed.policies} policies</span>
            </div>
          </div>
        )}

        <div className="row auth-tabs" style={{ margin: '14px 0' }}>
          {TABS.map(([k, label]) => (
            <button key={k} type="button" className={tab === k ? '' : 'secondary'}
              onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === 'leagues' && (<>
          <div className="card" style={{ maxWidth: 560 }}>
            <h2>Create an organization</h2>
            <p className="muted">
              Creates the league with the full starter content and emails its owner an
              invitation. You hold it until they accept, then ownership transfers to them.
            </p>
            <form onSubmit={createLeague}>
              <label>Organization name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <label>Owner's email</label>
              <input type="email" value={form.ownerEmail}
                onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} required />
              <div style={{ marginTop: 12 }}>
                <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create & invite owner'}</button>
              </div>
            </form>
            {msg && (
              <div style={{ marginTop: 14 }}>
                <p><strong>{msg.league.name}</strong> created.{' '}
                  {msg.emailed ? `Invitation emailed to ${msg.ownerEmail}.`
                    : `Could not email the invitation${msg.emailError ? ` (${msg.emailError})` : ''} — send this link instead:`}</p>
                {!msg.emailed && <code className="invite-link" style={{ wordBreak: 'break-all' }}>{msg.acceptUrl}</code>}
              </div>
            )}
          </div>

          <div className="card">
            <h2>All organizations</h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Owner</th><th>Members</th><th>Created</th></tr></thead>
                <tbody>
                  {leagues.map((l) => (
                    <tr key={l.id}>
                      <td><Link to={`/l/${l.id}`}>{l.name}</Link></td>
                      <td>{l.owner ? `${l.owner.displayName} (${l.owner.email})` : <span className="muted">—</span>}</td>
                      <td>{l.memberCount}</td>
                      <td>{new Date(l.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>)}

        {tab === 'email' && (
          <div className="card">
            <h2>Email suppression list</h2>
            <p className="muted">
              Addresses here receive no mail except password resets. Removing one restores delivery.
            </p>
            <form onSubmit={searchSup} className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input placeholder="Filter by email…" value={supQ} onChange={(e) => setSupQ(e.target.value)}
                style={{ flex: '1 1 220px', minWidth: 0 }} />
              <button type="submit" className="secondary">Search</button>
            </form>
            {sup.length === 0 && <p className="muted">No suppressed addresses.</p>}
            {sup.map((s) => (
              <div key={s.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>{s.email}</span>
                <span className="badge">{s.reason}</span>
                <span className="muted" style={{ fontSize: '0.78rem' }}>{new Date(s.createdAt).toLocaleDateString()}</span>
                <button type="button" className="secondary" onClick={() => restore(s.email)}>Restore</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'admins' && (
          <div className="card" style={{ maxWidth: 620 }}>
            <h2>Super admins</h2>
            <p className="muted">They must already have an account before they can be promoted.</p>
            <form onSubmit={promote} className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <input type="email" placeholder="email@example.com" value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)} required style={{ flex: '1 1 220px', minWidth: 0 }} />
              <button type="submit">Promote</button>
            </form>
            {admins.map((a) => (
              <div key={a.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>
                  {a.displayName} <span className="muted">{a.email}</span>
                </span>
                {a.id === user.id
                  ? <span className="badge">you</span>
                  : <button type="button" className="secondary" onClick={() => demote(a.id)}>Remove</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
