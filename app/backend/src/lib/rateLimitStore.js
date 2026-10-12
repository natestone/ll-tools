import { prisma } from './prisma.js'

/* A rate-limit store backed by MySQL, so every PM2 worker counts against the
   same tally.

   express-rate-limit's default store lives in process memory. That is correct
   for a single process and quietly wrong the moment you run more than one: with
   N workers behind PM2's round-robin, a limit of 5 becomes 5 per worker, and
   the password-reset limiter goes from "5 attempts per 15 minutes" to 40.

   The counter is advanced in a single statement so two workers incrementing at
   the same instant cannot lose an increment. The window is reset lazily inside
   that same statement — a row whose expiry has passed is rewritten as hit 1
   rather than being deleted first and re-inserted, which would race. */
export class MySQLRateLimitStore {
  /** @param {string} prefix distinguishes limiters that share a client IP */
  constructor(prefix) {
    this.prefix = prefix
    this.windowMs = 60_000
    // Sweep expired rows occasionally rather than on a timer: a timer in every
    // worker is N redundant DELETEs, and there is nothing to clean up on an
    // endpoint nobody is hitting.
    this.sweepEvery = 500
    this.sinceSweep = 0
  }

  init(options) {
    this.windowMs = options.windowMs
  }

  key(k) {
    return `${this.prefix}:${k}`.slice(0, 191)   // column is VARCHAR(191)
  }

  async increment(k) {
    const key = this.key(k)
    const windowSec = Math.ceil(this.windowMs / 1000)

    /* VALUES() is deprecated in MySQL 8.0.20+ but still supported, and unlike
       the newer row-alias syntax it also works on 5.7. Swap it for
       `AS new ... new.expiresAt` if this ever has to target MySQL 9. */
    await prisma.$executeRaw`
      INSERT INTO \`RateLimit\` (\`key\`, \`hits\`, \`expiresAt\`)
      VALUES (${key}, 1, DATE_ADD(NOW(3), INTERVAL ${windowSec} SECOND))
      ON DUPLICATE KEY UPDATE
        \`hits\`      = IF(\`expiresAt\` <= NOW(3), 1, \`hits\` + 1),
        \`expiresAt\` = IF(\`expiresAt\` <= NOW(3), VALUES(\`expiresAt\`), \`expiresAt\`)`

    const [row] = await prisma.$queryRaw`
      SELECT \`hits\`, \`expiresAt\` FROM \`RateLimit\` WHERE \`key\` = ${key}`

    if (++this.sinceSweep >= this.sweepEvery) {
      this.sinceSweep = 0
      // Fire and forget: a failed cleanup must never fail a request.
      prisma.$executeRaw`DELETE FROM \`RateLimit\` WHERE \`expiresAt\` <= NOW(3)`
        .catch((e) => console.error('[ratelimit] sweep failed:', e.message))
    }

    return {
      totalHits: Number(row?.hits ?? 1),
      resetTime: row?.expiresAt ? new Date(row.expiresAt) : new Date(Date.now() + this.windowMs),
    }
  }

  async decrement(k) {
    await prisma.$executeRaw`
      UPDATE \`RateLimit\` SET \`hits\` = GREATEST(\`hits\` - 1, 0) WHERE \`key\` = ${this.key(k)}`
  }

  async resetKey(k) {
    await prisma.$executeRaw`DELETE FROM \`RateLimit\` WHERE \`key\` = ${this.key(k)}`
  }

  async resetAll() {
    await prisma.$executeRaw`DELETE FROM \`RateLimit\` WHERE \`key\` LIKE ${`${this.prefix}:%`}`
  }
}

/* One line at each call site. Falls back to the in-memory store when running a
   single process, which avoids a database round trip per request for the common
   case — and is exactly equivalent, because with one process there is nothing
   to share. */
export const sharedStore = (prefix) =>
  (process.env.CLUSTERED === '1' ? { store: new MySQLRateLimitStore(prefix) } : {})
