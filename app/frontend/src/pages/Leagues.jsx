import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'

export default function Leagues() {
  const { user, setUser } = useAuth()
  const nav = useNavigate()
  const [leagues, setLeagues] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = () => api.get('/leagues').then(setLeagues)
  useEffect(() => { load() }, [])

  async function create(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const l = await api.post('/leagues', { name })
      setName(''); await load(); nav(`/l/${l.id}`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function logout() { await api.post('/auth/logout'); setUser(null) }

  return (
    <div>
      <div className="topbar">
        {/* the ".hide-sm" tail keeps the brand from pushing "Log out" off a 390px screen */}
        <span className="brand">GNGRLL<span className="hide-sm"> League Manager</span></span>
        <span className="spacer" />
        {user.isSuperAdmin && <Link to="/admin">Admin</Link>}
        <Link to="/profile" className="hide-sm profile-link" title="Your account">{user.displayName}</Link>
        <a href="#" onClick={logout}>Log out</a>
      </div>
      <div className="content">
        <h1>Your leagues</h1>
        <div className="grid cols2">
          {leagues.map((l) => (
            <Link key={l.id} to={`/l/${l.id}`} className="card">
              <h2>{l.name}</h2>
              <span className="pill">{l.isOwner ? 'Owner' : 'Officer'}</span>
            </Link>
          ))}
          {leagues.length === 0 && <p className="muted">No leagues yet — create one to clone the GNGRLL starter content.</p>}
        </div>
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>Create a league</h2>
          <form onSubmit={create}>
            <label>League name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Springfield Little League" required />
            {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}
            <div style={{ marginTop: 12 }}><button disabled={busy}>{busy ? 'Creating…' : 'Create league'}</button></div>
            <p className="muted" style={{ marginTop: 8 }}>You become the owner. All GNGRLL templates, calendars, tasks, policies & references are copied in for you to customize.</p>
          </form>
        </div>
      </div>
    </div>
  )
}
