import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'

/* Landing page for the link sent to a NEW email address.

   Works signed out on purpose: people open mail on a phone that is not logged
   in, and the token is what proves they control the mailbox. */
export default function ConfirmEmail() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState({ status: 'working' })
  const ran = useRef(false)

  useEffect(() => {
    // React 18 StrictMode mounts effects twice in development; without this the
    // second run would redeem a one-time token that the first already spent and
    // report failure for a change that actually succeeded.
    if (ran.current) return
    ran.current = true

    if (!token) { setState({ status: 'error', error: 'That link is missing its code.' }); return }
    api.post('/auth/email-change/confirm', { token })
      .then((r) => setState({ status: 'done', email: r.email }))
      .catch((e) => setState({ status: 'error', error: e.message || 'That link is invalid or has expired.' }))
  }, [token])

  return (
    <div className="center">
      <div className="card">
        <h1>Email address</h1>
        {state.status === 'working' && <p className="muted">Confirming…</p>}
        {state.status === 'done' && (<>
          <p>Your email address is now <strong>{state.email}</strong>.</p>
          <p className="muted">Use it the next time you sign in.</p>
          <p style={{ marginTop: 16 }}><Link to="/login">Go to sign in</Link></p>
        </>)}
        {state.status === 'error' && (<>
          <p className="err">{state.error}</p>
          <p className="muted">Ask for a new confirmation link from your account page.</p>
          <p style={{ marginTop: 16 }}><Link to="/login">Go to sign in</Link></p>
        </>)}
      </div>
    </div>
  )
}
