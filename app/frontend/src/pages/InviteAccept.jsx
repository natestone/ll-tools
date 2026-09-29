import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'

const MIN_PW = 8   // must match the server

/* An invited officer usually has no account yet, so this page renders signed out.
   It shows what they're being asked to join first, then lets them either create
   an account or sign in — and redeems the token either way. */
export default function InviteAccept() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { user, setUser } = useAuth()
  const nav = useNavigate()

  const [invite, setInvite] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [mode, setMode] = useState('register')   // register | login
  const [form, setForm] = useState({ displayName: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) { setLoadErr('This invitation link is missing its code.'); return }
    api.get(`/invites/preview?token=${encodeURIComponent(token)}`)
      .then((r) => {
        setInvite(r)
        setForm((f) => ({ ...f, email: r.email }))
        // if that address already has an account, sign-in is the likely path
        if (r.hasAccount) setMode('login')
      })
      .catch((e) => setLoadErr(e.message))
  }, [token])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const go = (leagueId) => nav(`/l/${leagueId}`)

  // already signed in — one click
  async function acceptAsMe() {
    setErr(''); setBusy(true)
    try { go((await api.post('/invites/accept', { token })).leagueId) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      if (mode === 'register') {
        const r = await api.post('/invites/register', { token, ...form })
        setUser(r.user)
        go(r.leagueId)
      } else {
        const u = await api.post('/auth/login', { email: form.email, password: form.password })
        setUser(u)
        go((await api.post('/invites/accept', { token })).leagueId)
      }
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (loadErr) {
    return (
      <div className="center">
        <div className="card">
          <h1>Invitation</h1>
          <p className="err" style={{ overflowWrap: 'anywhere' }}>{loadErr}</p>
          <p style={{ marginTop: 14 }}><Link to="/login">Go to log in</Link></p>
        </div>
      </div>
    )
  }
  if (!invite) return <div className="center card">Loading invitation…</div>

  const roles = invite.roleNames?.length ? invite.roleNames.join(', ') : null
  const summary = (
    <>
      <p>
        {invite.inviterName ? <strong>{invite.inviterName}</strong> : 'Someone'} invited you to help run{' '}
        <strong>{invite.leagueName}</strong>.
      </p>
      {roles && <p>You'll be set up as: <strong>{roles}</strong></p>}
    </>
  )

  if (user) {
    return (
      <div className="center">
        <div className="card">
          <h1>Join {invite.leagueName}</h1>
          {summary}
          <p className="muted">You're signed in as {user.email}.</p>
          {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}
          <div style={{ marginTop: 14 }}>
            <button type="button" onClick={acceptAsMe} disabled={busy}>
              {busy ? 'Joining…' : 'Accept invitation'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="center">
      <div className="card">
        <h1>Join {invite.leagueName}</h1>
        {summary}

        <div className="row auth-tabs" style={{ margin: '16px 0 12px' }}>
          <button type="button" className={mode === 'register' ? '' : 'secondary'}
            onClick={() => { setMode('register'); setErr('') }}>Create account</button>
          <button type="button" className={mode === 'login' ? '' : 'secondary'}
            onClick={() => { setMode('login'); setErr('') }}>I already have one</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (<>
            <label>Your name</label>
            <input value={form.displayName} onChange={set('displayName')} required autoFocus />
          </>)}
          <label>Email</label>
          <input type="email" value={form.email} onChange={set('email')} required />
          <label>Password</label>
          <input type="password" value={form.password} onChange={set('password')} required
            autoFocus={mode === 'login'} />
          {mode === 'register' && form.password.length > 0 && form.password.length < MIN_PW && (
            <p className="muted">At least {MIN_PW} characters.</p>
          )}
          {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}
          <div style={{ marginTop: 14 }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Joining…' : (mode === 'register' ? 'Create account & join' : 'Sign in & join')}
            </button>
          </div>
          {mode === 'login' && (
            <p style={{ marginTop: 14 }}><Link to="/forgot">Forgot password?</Link></p>
          )}
        </form>
      </div>
    </div>
  )
}
