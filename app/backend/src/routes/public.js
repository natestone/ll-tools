import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma.js'

/* ============================================================================
   Public All-Star endpoints. No session: a parent filling in the signup form is
   not a league member and never will be.

   Access is by unguessable slug, so every route here is rate limited and
   returns the same 404 for a bad token as for a closed season — a probe should
   not be able to tell which leagues exist.
   ========================================================================== */

export const publicRouter = Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})
publicRouter.use(limiter)

const dateOnly = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`) : null)
const notFound = (res) => res.status(404).json({ error: 'This signup link is not valid.' })

/** Everything the signup page needs: league name, consent text, levels. */
publicRouter.get('/allstar/:slug', async (req, res) => {
  const season = await prisma.allStarSeason.findUnique({
    where: { publicSlug: req.params.slug },
    include: { league: { select: { name: true } },
      levels: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  })
  if (!season) return notFound(res)
  res.json({
    leagueName: season.league.name,
    year: season.year,
    signupOpen: season.signupOpen,
    consentMd: season.consentMd,
    // bounds are what the form filters on; ids are needed to submit
    levels: season.levels.map((l) => ({ id: l.id, name: l.name, bornFrom: l.bornFrom, bornTo: l.bornTo })),
  })
})

/** A parent signing one player up for one or more levels. */
publicRouter.post('/allstar/:slug/signup', async (req, res) => {
  const season = await prisma.allStarSeason.findUnique({
    where: { publicSlug: req.params.slug }, include: { levels: true },
  })
  if (!season) return notFound(res)
  if (!season.signupOpen) return res.status(400).json({ error: 'Signups for this season are closed.' })

  const playerName = String(req.body?.playerName || '').trim()
  const parentName = String(req.body?.parentName || '').trim()
  const playerDob = dateOnly(req.body?.playerDob)
  const levelIds = Array.isArray(req.body?.levelIds) ? req.body.levelIds.map(Number) : []

  if (!playerName) return res.status(400).json({ error: "The player's name is required." })
  if (!parentName) return res.status(400).json({ error: 'Type your name to sign the agreement.' })
  if (!playerDob || Number.isNaN(playerDob.getTime())) return res.status(400).json({ error: "The player's date of birth is required." })
  if (!levelIds.length) return res.status(400).json({ error: 'Choose at least one level.' })

  // Eligibility is re-checked here, never trusted from the browser: the form
  // hides ineligible levels, but the request can be made without the form.
  const chosen = season.levels.filter((l) => levelIds.includes(l.id))
  if (chosen.length !== levelIds.length) return res.status(400).json({ error: 'Unknown level selected.' })
  const ineligible = chosen.filter((l) => playerDob < l.bornFrom || playerDob > l.bornTo)
  if (ineligible.length)
    return res.status(400).json({
      error: `That date of birth is not eligible for ${ineligible.map((l) => l.name).join(', ')}.`,
    })

  const signup = await prisma.allStarSignup.create({
    data: {
      seasonId: season.id, playerName, playerDob, parentName,
      parentEmail: String(req.body?.parentEmail || '').trim().toLowerCase() || null,
      parentPhone: String(req.body?.parentPhone || '').trim() || null,
      // snapshot: editing the form later must not change what was agreed to
      consentMd: season.consentMd,
      signedIp: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() || null,
      levels: { create: chosen.map((l) => ({ levelId: l.id })) },
    },
    include: { levels: { include: { level: true } } },
  })
  res.status(201).json({
    ok: true, playerName: signup.playerName,
    levels: signup.levels.map((l) => l.level.name),
  })
})
