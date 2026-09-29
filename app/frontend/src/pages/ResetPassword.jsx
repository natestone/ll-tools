import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'

const MIN = 8   // must match the server's minimum in routes/auth.js

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const tooShort = pw.length > 0 && pw.length < MIN
  const mismatch = pw2.length > 0 && pw !== pw2
  const canSubmit = pw.length >= MIN && pw === pw2 && !busy

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api.post('/auth/reset', { token, password: pw })
      setDone(true)
      setTimeout(() => nav('/login'), 2500)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!token) {
    return (
      <div className="center">
        <div className="card">
          <h1>Reset your password</h1>
          <p className="err">That link is missing its token. Request a new one.</p>
          <p style={{ marginTop: 14 }}><Link to="/forgot">Send a new reset link</Link></p>
        </div>
      </div>
    )
  }

  return (
    <div className="center">
      <div className="card">
        <h1>Choose a new password</h1>
        {done ? (
          <>
            <p>Your password has been changed, and you've been signed out everywhere else.</p>
            <p className="muted">Taking you to the log in page…</p>
            <p style={{ marginTop: 14 }}><Link to="/login">Log in now</Link></p>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>New password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
            {tooShort && <p className="muted">At least {MIN} characters.</p>}
            <label>Confirm new password</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            {mismatch && <p className="err">Those don't match.</p>}
            {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}
            <div style={{ marginTop: 14 }}>
              <button type="submit" disabled={!canSubmit}>{busy ? 'Saving…' : 'Set new password'}</button>
            </div>
            <p style={{ marginTop: 14 }}><Link to="/forgot">Request a new link</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
