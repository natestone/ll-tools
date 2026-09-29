import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api.post('/auth/forgot', { email })
      setSent(true)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="center">
      <div className="card">
        <h1>Reset your password</h1>
        {sent ? (
          // Deliberately the same message whether or not the address exists —
          // the server won't confirm which addresses have accounts.
          <>
            <p>If <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong> has an account,
               a reset link is on its way. It expires in an hour.</p>
            <p className="muted">Check your spam folder if it hasn't arrived in a few minutes.</p>
            <p style={{ marginTop: 16 }}><Link to="/login">Back to log in</Link></p>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="muted">Enter your email and we'll send you a link to choose a new password.</p>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}
            <div style={{ marginTop: 14 }}>
              <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            </div>
            <p style={{ marginTop: 14 }}><Link to="/login">Back to log in</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
