import { Router } from 'express'
import dns from 'node:dns/promises'
import net from 'node:net'
import { requireAuth, loadLeague } from '../middleware/auth.js'

/* ============================================================================
   GET /api/leagues/:leagueId/unfurl?url=...
   Fetches a pasted URL server-side and returns its document title, so the link
   form can auto-fill the label. The browser can't do this itself: docs.google.com
   sends no CORS headers, so a client-side fetch is blocked.

   This endpoint takes a URL from a user and makes the server request it, which
   is an SSRF primitive. Everything below exists to keep it from being used to
   probe the private network it runs in (databases, admin ports, cloud metadata
   at 169.254.169.254). It is also behind requireAuth + loadLeague so it is never
   an open proxy.
   ========================================================================== */

export const unfurlRouter = Router({ mergeParams: true })
unfurlRouter.use(requireAuth, loadLeague)

const TIMEOUT_MS = 6000
const MAX_BYTES = 512 * 1024   // titles live in <head>; never read a whole page
const MAX_REDIRECTS = 3

/* ---- address filtering -------------------------------------------------- */

const v4Blocked = [
  [[0, 0, 0, 0], 8],        // "this" network
  [[10, 0, 0, 0], 8],       // private
  [[100, 64, 0, 0], 10],    // carrier NAT
  [[127, 0, 0, 0], 8],      // loopback
  [[169, 254, 0, 0], 16],   // link-local — includes cloud metadata 169.254.169.254
  [[172, 16, 0, 0], 12],    // private
  [[192, 0, 0, 0], 24],     // IETF protocol assignments
  [[192, 168, 0, 0], 16],   // private
  [[198, 18, 0, 0], 15],    // benchmarking
  [[224, 0, 0, 0], 4],      // multicast
  [[240, 0, 0, 0], 4],      // reserved / broadcast
]

const inV4Cidr = (ip, [base, bits]) => {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const toInt = (a) => ((a[0] << 24) >>> 0) + (a[1] << 16) + (a[2] << 8) + a[3]
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (toInt(p) & mask) === (toInt(base) & mask)
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return v4Blocked.some((c) => inV4Cidr(ip, c))
  if (!net.isIPv6(ip)) return true                       // unparseable → refuse
  const a = ip.toLowerCase()
  // IPv4-mapped (::ffff:127.0.0.1) must be judged on the embedded v4 address
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateAddress(mapped[1])
  if (a === '::' || a === '::1') return true             // unspecified / loopback
  const head = parseInt(a.split(':')[0] || '0', 16)
  if ((head & 0xfe00) === 0xfc00) return true            // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true            // fe80::/10 link-local
  return false
}

// Resolve the hostname and refuse if ANY address it answers with is internal.
async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('blocked address')
    return
  }
  let addrs
  try {
    addrs = await dns.lookup(hostname, { all: true })
  } catch {
    throw new Error('could not resolve host')
  }
  if (!addrs.length) throw new Error('could not resolve host')
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('blocked address')
}

function parseTarget(raw) {
  let u
  try { u = new URL(raw) } catch { throw new Error('not a valid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) links')
  return u
}

/* ---- title extraction --------------------------------------------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#34': '"' }
const decode = (s) => s
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase()
    if (ENTITIES[k]) return ENTITIES[k]
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16))
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10))
    return m
  })
  .replace(/\s+/g, ' ')
  .trim()

// Google suffixes its tab titles with the product name; strip it for a clean label.
const GOOGLE_SUFFIX = /\s*[-–—]\s*Google (Docs|Sheets|Slides|Forms|Drive|Drawings|My Maps)\s*$/i

function extractTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i)
  const tag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const raw = decode(og?.[1] || tag?.[1] || '')
  return raw || null
}

// A private Google file either redirects to a sign-in wall (whose title would be
// "Sign in - Google Accounts" — worse than nothing) or serves a JS shell with no
// usable title at all. Both mean the same thing to the user.
function isSignInWall(finalUrl, title) {
  const h = finalUrl.hostname
  if (h === 'accounts.google.com' || h.endsWith('.okta.com') || h === 'login.microsoftonline.com') return true
  return /^(sign in|log in|login|sign-in)\b/i.test(title || '')
}

const isGoogleDocHost = (h) => h === 'docs.google.com' || h === 'drive.google.com'

const NOT_SHARED = 'That file isn’t shared publicly, so its name can’t be read. '
  + 'Set it to “Anyone with the link”, or just type a label.'

/* ---- fetch with per-hop validation -------------------------------------- */

async function fetchTitle(startUrl) {
  let url = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname)      // re-checked on EVERY hop: a public
                                              // URL can redirect to 127.0.0.1
    const res = await fetch(url, {
      redirect: 'manual',                     // we follow by hand to re-validate
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Google serves the real <title> to a normal browser UA
        'User-Agent': 'Mozilla/5.0 (compatible; GNGRLL-LeagueManager/1.0; +link-preview)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error('redirect without a target')
      res.body?.cancel?.()
      url = parseTarget(new URL(loc, url).toString())
      continue
    }
    if (!res.ok) throw new Error(`site returned ${res.status}`)

    const ctype = res.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml/i.test(ctype)) throw new Error('not an HTML page')

    // Read only the first chunk of bytes — enough for <head>, never the whole doc
    const reader = res.body?.getReader()
    if (!reader) throw new Error('empty response')
    const parts = []
    let total = 0
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      total += value.length
      // stop as soon as </head> has certainly been seen
      if (Buffer.concat(parts).toString('utf8').match(/<\/head>/i)) break
    }
    reader.cancel().catch(() => {})
    const html = Buffer.concat(parts).toString('utf8')
    return { title: extractTitle(html), finalUrl: url }
  }
  throw new Error('too many redirects')
}

/* ---- route -------------------------------------------------------------- */

unfurlRouter.get('/', async (req, res) => {
  const raw = String(req.query.url || '').trim()
  if (!raw) return res.status(400).json({ error: 'url is required' })

  let target
  try { target = parseTarget(raw) } catch (e) { return res.status(400).json({ error: e.message }) }

  try {
    const { title, finalUrl } = await fetchTitle(target)
    // Check the sign-in wall FIRST: a private file redirects to accounts.google.com,
    // which serves no usable title — so a title-less result there is a permission
    // problem, not a missing <title>. Judge the pasted host too, since by the time
    // we land on the wall the Google host is no longer the final one.
    if (isSignInWall(finalUrl, title) || isGoogleDocHost(target.hostname) || isGoogleDocHost(finalUrl.hostname)) {
      if (!title || isSignInWall(finalUrl, title)) return res.json({ title: null, reason: NOT_SHARED })
    }
    if (!title) return res.json({ title: null, reason: 'no title found on that page' })
    res.json({ title: title.replace(GOOGLE_SUFFIX, '').trim() || title, site: finalUrl.hostname })
  } catch (e) {
    const msg = e?.name === 'TimeoutError' ? 'the site took too long to respond' : (e?.message || 'lookup failed')
    // 200 with a reason: a failed lookup is a normal outcome, not an app error —
    // the user can always just type the label.
    res.json({ title: null, reason: msg })
  }
})
