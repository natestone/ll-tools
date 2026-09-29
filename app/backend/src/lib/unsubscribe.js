import crypto from 'node:crypto'
import { prisma } from './prisma.js'

/* ============================================================================
   Unsubscribe links.

   The link is stateless: the address travels in the URL alongside an HMAC of it.
   No database row is issued up front, the link never expires (an unsubscribe link
   in a two-year-old email must still work), and the signature means nobody can
   unsubscribe a third party by editing the address in the URL.
   ========================================================================== */

const SECRET = () => process.env.MAIL_SECRET || process.env.SESSION_SECRET || 'dev-unsubscribe-secret'

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url')
const unb64url = (s) => Buffer.from(String(s), 'base64url').toString('utf8')

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase()

export function signEmail(email) {
  return crypto.createHmac('sha256', SECRET()).update(normalizeEmail(email)).digest('base64url')
}

/** Verify ?e=&t= from an unsubscribe link. Returns the email, or null. */
export function verifyUnsubToken(e, t) {
  if (!e || !t) return null
  let email
  try { email = normalizeEmail(unb64url(e)) } catch { return null }
  if (!email) return null
  const expected = Buffer.from(signEmail(email))
  const given = Buffer.from(String(t))
  // timingSafeEqual throws on a length mismatch, so guard first
  if (expected.length !== given.length) return null
  if (!crypto.timingSafeEqual(expected, given)) return null
  return email
}

/** The URL that goes in the email footer. */
export function unsubscribeUrl(email) {
  const base = (process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '')
  return `${base}/unsubscribe?e=${b64url(normalizeEmail(email))}&t=${signEmail(email)}`
}

/* The RFC 8058 one-click endpoint mail clients call server-to-server for their
   own native "Unsubscribe" button. Points at the API, not the React page. */
export function unsubscribeApiUrl(email) {
  const base = (process.env.API_URL || process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .replace(/\/+$/, '')
  return `${base}/api/unsubscribe?e=${b64url(normalizeEmail(email))}&t=${signEmail(email)}`
}

export async function isSuppressed(email) {
  const e = normalizeEmail(email)
  if (!e) return false
  return !!(await prisma.emailSuppression.findUnique({ where: { email: e } }))
}

export async function suppress(email, reason = 'unsubscribed') {
  const e = normalizeEmail(email)
  return prisma.emailSuppression.upsert({
    where: { email: e },
    update: { reason },
    create: { email: e, reason },
  })
}

export async function unsuppress(email) {
  const e = normalizeEmail(email)
  return prisma.emailSuppression.deleteMany({ where: { email: e } })
}
