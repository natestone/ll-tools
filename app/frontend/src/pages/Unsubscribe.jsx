import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api.js'

/* Public landing page for the unsubscribe link in every email footer.

   It performs the unsubscribe itself rather than relying on the URL being
   fetched: corporate link scanners (Outlook Safe Links and friends) follow every
   link in an incoming message, and a plain GET that opts people out would
   unsubscribe them before they ever read the email. Scanners don't run JavaScript,
   so doing the write from here keeps accidental opt-outs from happening. */
export default function Unsubscribe() {
  const [params] = useSearchParams()
  const e = params.get('e') || ''
  const t = params.get('t') || ''
  const [state, setState] = useState('working')   // working | done | resubscribed | error
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const ran = useRef(false)   // StrictMode double-invokes effects in dev

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    if (!e || !t) { setState('error'); setErr('This unsubscribe link is incomplete.'); return }
    api.get(`/unsubscribe?e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`)
      .then((r) => { setEmail(r.email); setState('done') })
      .catch((ex) => { setState('error'); setErr(ex.message) })
  }, [e, t])

  async function resubscribe() {
    try {
      await api.post(`/unsubscribe/resubscribe?e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`)
      setState('resubscribed')
    } catch (ex) { setErr(ex.message) }
  }

  return (
    <div className="center">
      <div className="card">
        {state === 'working' && <p>Unsubscribing…</p>}

        {state === 'done' && (<>
          <h1>You have successfully unsubscribed</h1>
          <p>
            {email ? <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong> : 'That address'} will
            no longer receive emails from us.
          </p>
          <p className="muted" style={{ marginTop: 14 }}>
            Password reset emails are still sent, so you're never locked out of your account.
          </p>
          <p style={{ marginTop: 18 }}>
            Didn't mean to do this?{' '}
            <a href="#" onClick={(ev) => { ev.preventDefault(); resubscribe() }}>Resubscribe</a>
          </p>
          {err && <p className="err">{err}</p>}
        </>)}

        {state === 'resubscribed' && (<>
          <h1>You're subscribed again</h1>
          <p>
            {email ? <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong> : 'That address'} will
            receive emails from us again.
          </p>
        </>)}

        {state === 'error' && (<>
          <h1>Unsubscribe</h1>
          <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>
          <p className="muted">Use the unsubscribe link from a recent email, or contact your league.</p>
        </>)}

        <p style={{ marginTop: 20 }}><Link to="/login">Go to League Manager</Link></p>
      </div>
    </div>
  )
}
