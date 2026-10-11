import express from 'express'
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
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 30 * 864e5 },
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
