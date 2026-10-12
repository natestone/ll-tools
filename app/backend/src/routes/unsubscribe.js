import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { sharedStore } from '../lib/rateLimitStore.js'
import { verifyUnsubToken, suppress, unsuppress, isSuppressed } from '../lib/unsubscribe.js'

/* ============================================================================
   Public unsubscribe. No session — the whole point is that someone who has no
   account, or can't sign in, can still opt out from a link in an email.

   The address is only trusted because of the HMAC in the link, so an attacker
   can't unsubscribe a third party by editing the URL.

   Both verbs are supported:
     GET  — the React landing page calls this
     POST — RFC 8058 one-click, which Gmail/Outlook call server-to-server for
            their own native Unsubscribe button
   ========================================================================== */

export const unsubscribeRouter = Router()

const limiter = rateLimit({
  ...sharedStore('unsub'),
  windowMs: 15 * 60 * 1000, limit: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

async function doUnsubscribe(req, res) {
  const email = verifyUnsubToken(req.query.e ?? req.body?.e, req.query.t ?? req.body?.t)
  if (!email) return res.status(400).json({ error: 'This unsubscribe link is not valid.' })
  await suppress(email, 'unsubscribed')
  console.log(`[mail] ${email} unsubscribed`)
  res.json({ ok: true, email })
}

unsubscribeRouter.get('/', limiter, doUnsubscribe)
unsubscribeRouter.post('/', limiter, doUnsubscribe)

// Status, so the landing page can tell "just unsubscribed" from "already was".
unsubscribeRouter.get('/status', limiter, async (req, res) => {
  const email = verifyUnsubToken(req.query.e, req.query.t)
  if (!email) return res.status(400).json({ error: 'This unsubscribe link is not valid.' })
  res.json({ email, suppressed: await isSuppressed(email) })
})

// Undo. A one-click unsubscribe with no way back is a support ticket waiting to
// happen — someone's mail client prefetches the link, or they mis-tap on a phone.
unsubscribeRouter.post('/resubscribe', limiter, async (req, res) => {
  const email = verifyUnsubToken(req.query.e ?? req.body?.e, req.query.t ?? req.body?.t)
  if (!email) return res.status(400).json({ error: 'This link is not valid.' })
  await unsuppress(email)
  console.log(`[mail] ${email} resubscribed`)
  res.json({ ok: true, email })
})
