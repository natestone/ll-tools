import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'

/* The signed-in user's own account page.

   Both changes here are confirmed by email rather than applied immediately.
   Changing the address this way proves the new mailbox is real before anything
   depends on it -- otherwise a typo locks someone out of their own account,
   with every future reset link going to an address that does not exist. */
export default function Profile({ user }) {
  const nav = useNavigate()
  const logout = async (e) => {
    e.preventDefault()
    await api.post('/auth/logout')
    window.location.href = '/login'
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailMsg, setEmailMsg] = useState(null)
  const [emailErr, setEmailErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [pwMsg, setPwMsg] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  async function changeEmail(e) {
    e.preventDefault(); setEmailErr(''); setEmailMsg(null); setBusy(true)
    try {
      const r = await api.post('/auth/email-change', { email: email.trim(), password })
      setEmailMsg(r.message); setEmail(''); setPassword('')
    } catch (err) {
      setEmailErr(err.message || 'Could not request the change.')
    } finally { setBusy(false) }
  }

  async function sendReset() {
    setPwBusy(true); setPwMsg('')
    try {
      // The same endpoint the login page uses. Deliberately not a "type a new
      // password here" form: proving control of the mailbox is the point, and
      // it means one reset path to reason about rather than two.
      await api.post('/auth/forgot', { email: user.email })
      setPwMsg(`We've emailed a password reset link to ${user.email}. It expires in an hour.`)
    } catch {
      setPwMsg('Could not send the email. Try again shortly.')
    } finally { setPwBusy(false) }
  }

  return (
    <div>
      <div className="topbar">
        <span className="brand">GNGRLL<span className="hide-sm"> League Manager</span></span>
        <span className="spacer" />
        <Link to="/">My leagues</Link>
        <a href="#" onClick={logout}>Log out</a>
      </div>

      <div className="content profile-page">
      <div className="card">
        <div className="section-head">
          <h1 style={{ margin: 0 }}>Your account</h1>
          <button type="button" className="secondary" onClick={() => nav(-1)}>Back</button>
        </div>

        <table className="data-table profile-facts">
          <tbody>
            <tr><th>Name</th><td>{user.displayName}</td></tr>
            <tr><th>Email</th><td>{user.email}</td></tr>
            {user.isSuperAdmin && (
              <tr><th>Access</th><td><span className="badge">Super admin</span></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Change your email address</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          You sign in with this address, and it is where password resets go. We'll send a
          confirmation link to the new address — the change only happens once you open it.
        </p>

        <form onSubmit={changeEmail}>
          <label>New email address</label>
          <input type="email" value={email} required placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)} />

          <label>Your current password</label>
          <input type="password" value={password} required autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
          <p className="muted" style={{ fontSize: '0.78rem' }}>
            Asked for because this changes how you sign in — a session left open on a
            shared computer shouldn't be enough.
          </p>

          {emailErr && <p className="err">{emailErr}</p>}
          {emailMsg && <p className="ok-msg">{emailMsg}</p>}

          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={busy || !email.trim() || !password}>
              {busy ? 'Sending…' : 'Send confirmation link'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Change your password</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          We'll email a link to <strong>{user.email}</strong>. Opening it lets you set a new
          password. Everyone signed in as you elsewhere is signed out at that point.
        </p>
        {pwMsg && <p className="ok-msg">{pwMsg}</p>}
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={sendReset} disabled={pwBusy}>
            {pwBusy ? 'Sending…' : 'Email me a reset link'}
          </button>
        </div>
      </div>

      <p className="muted">
        Need something else changed? <Link to="/">Back to your leagues</Link>.
      </p>
      </div>
    </div>
  )
}
