import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import session from 'express-session'
import cors from 'cors'
import expressMySqlSession from 'express-mysql-session'
import { authRouter } from './routes/auth.js'
import { leaguesRouter, invitesRouter } from './routes/leagues.js'
import { contentRouter } from './routes/content.js'
import { schedulerRouter } from './routes/scheduler.js'
import { permissionsRouter } from './routes/permissions.js'
import { meetingsRouter } from './routes/meetings.js'
import { seasonsRouter } from './routes/seasons.js'
import { unfurlRouter } from './routes/unfurl.js'
import { unsubscribeRouter } from './routes/unsubscribe.js'
import { adminRouter } from './routes/admin.js'
import { allStarsRouter } from './routes/allstars.js'
import { publicRouter } from './routes/public.js'
import { verifyMailer } from './lib/mailer.js'

const PORT = process.env.PORT || 3001
const ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

const here = path.dirname(fileURLToPath(import.meta.url))
/* In production this process also serves the built front end, so the app and
   its API share one origin. That is not a convenience: cross-origin session
   cookies need SameSite=None + Secure and are dropped outright by some mobile
   browsers' tracking protection. Same origin sidesteps the whole category. */
const CLIENT_DIR = process.env.CLIENT_DIR || path.resolve(here, '../../frontend/dist')

/* Behind nginx/TLS the session cookie must be Secure, or it travels in clear
   on any accidental http:// hop. Off by default so plain-http local dev still
   logs in; set COOKIE_SECURE=1 in the production env file. */
const SECURE_COOKIE = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || '')

// session store in MySQL (parsed from DATABASE_URL)
const dbUrl = new URL(process.env.DATABASE_URL)
const MySQLStore = expressMySqlSession(session)
const sessionStore = new MySQLStore({
  host: dbUrl.hostname,
  port: Number(dbUrl.port || 3306),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.replace(/^\//, ''),
  createDatabaseTable: true,
})

const app = express()
app.set('trust proxy', 1)
app.use(cors({ origin: ORIGIN, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(session({
  name: 'gngrll.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, maxAge: 30 * 864e5 },
}))

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/unsubscribe', unsubscribeRouter) // public: no session, HMAC-signed links
app.use('/api/public', publicRouter)   // no session: token-addressed signup/ballot
app.use('/api/leagues/:leagueId/all-stars', allStarsRouter)
app.use('/api/admin', adminRouter)   // super-admin only (404s for everyone else)
app.use('/api/auth', authRouter)
app.use('/api/invites', invitesRouter)
app.use('/api/leagues/:leagueId/scheduler', schedulerRouter) // embedded scheduler state
app.use('/api/leagues/:leagueId/permissions', permissionsRouter) // owner permission matrix
app.use('/api/leagues/:leagueId/meetings', meetingsRouter) // board meetings + agenda wizard
app.use('/api/leagues/:leagueId/seasons', seasonsRouter) // season switching + year rollover
app.use('/api/leagues/:leagueId/unfurl', unfurlRouter) // read a pasted link's title for the label
app.use('/api/leagues/:leagueId', contentRouter) // content sub-routes (email-templates, calendar, tasks, ...)
app.use('/api/leagues', leaguesRouter)            // league CRUD + members/roles/assignments/invites

/* An unmatched /api path is a client bug, so answer in JSON. Without this it
   would fall through to the SPA fallback below and a broken fetch would get a
   200 and a page of HTML instead of a 404. */
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))

/* The built front end, when it exists. Absent in dev, where Vite serves it. */
if (fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
  app.use(express.static(CLIENT_DIR, {
    index: false,
    // Vite fingerprints asset filenames, so they are safe to cache hard.
    maxAge: '1y',
    setHeaders: (res, filePath) => {
      // index.html is the one file that must never be cached, or browsers keep
      // loading the previous deploy's asset names after an update.
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
    },
  }))
  // Client-side routes (/l/1/tasks, /allstar/:slug, ...) are not files on disk;
  // hand them the shell and let the router sort it out.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    // sendFile bypasses the static middleware above, so the shell sets its own
    // no-cache header here too -- a cached shell points at the previous
    // deploy's fingerprinted assets, which are gone after the next build.
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(CLIENT_DIR, 'index.html'))
  })
  console.log(`Serving client from ${CLIENT_DIR}`)
} else {
  console.log(`No client build at ${CLIENT_DIR} — API only (normal in dev)`)
}

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'server error' })
})

/* Express 4 does not catch rejections from async route handlers: one unhandled
   throw anywhere takes the whole API down for every league. Until handlers are
   wrapped individually, log it loudly and keep serving — a single broken request
   should not be an outage. */
process.on('unhandledRejection', (err) => {
  console.error('[fatal-guard] unhandled rejection in a route — request dropped, server kept alive:', err)
})

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
  verifyMailer()   // proves mail credentials work before anyone needs them
})
