/* PM2 process definition for the League Manager API.
 *
 * One process serves both the JSON API and the built front end, so there is a
 * single thing to watch, restart and read logs from.
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save                 # persist across reboots (after pm2 startup)
 *   pm2 logs ll-manager
 *
 * Secrets live in app/backend/.env, which node reads via --env-file. They are
 * deliberately NOT in this file: it is committed to git.
 *
 * ---------------------------------------------------------------------------
 * CONCURRENCY
 *
 * Set WEB_CONCURRENCY to the number of workers. Default is 2.
 *
 *   WEB_CONCURRENCY=4 pm2 startOrReload ecosystem.config.cjs --env production
 *
 * Node is single-threaded per process, so more workers = more cores used. But
 * this app is almost entirely waiting on MySQL, not computing, and one worker
 * already absorbs far more than a league board generates. Extra workers buy
 * two real things: a crash or a slow request no longer blocks everyone, and
 * `pm2 reload` becomes genuinely zero-downtime because workers restart one at
 * a time. They do not make anything measurably faster.
 *
 * Two hard limits to respect before raising it:
 *
 *   1. DATABASE CONNECTIONS. Each worker opens its own Prisma pool (default
 *      (cpus * 2) + 1 -- on a 32-core box that is 65 PER WORKER) plus ~10 for
 *      the session store. MySQL's default max_connections is 151, so four
 *      workers on a big box can exhaust it and the app starts failing with
 *      "Too many connections". Pin the pool explicitly in DATABASE_URL:
 *
 *          ...?connection_limit=10
 *
 *      Budget: workers * (connection_limit + 10) must stay well under
 *      max_connections. Check with: SHOW VARIABLES LIKE 'max_connections';
 *
 *   2. RATE LIMITING. Counters are per-process by default, so N workers means
 *      N times the allowance. CLUSTERED=1 (set below) switches them to the
 *      shared MySQL store. Do not run multiple workers without it.
 * ------------------------------------------------------------------------- */

/* Worker count, in priority order:
     1. WEB_CONCURRENCY in the environment  (one-off: WEB_CONCURRENCY=4 ./deploy/deploy.sh)
     2. WEB_CONCURRENCY in app/backend/.env (persistent -- survives every deploy)
     3. 2
   Reading .env matters: without it the count reverts to the default on the next
   deploy, silently dropping the box back to two workers. */
const fs = require('fs')
const path = require('path')

function fromEnvFile() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, 'app/backend/.env'), 'utf8')
    const m = txt.match(/^\s*(?:export\s+)?WEB_CONCURRENCY\s*=\s*"?(\d+)"?/m)
    return m ? Number(m[1]) : null
  } catch { return null }
}

const workers = Number(process.env.WEB_CONCURRENCY) || fromEnvFile() || 2

module.exports = {
  apps: [{
    name: 'll-manager',
    cwd: __dirname + '/app/backend',
    script: 'src/index.js',
    node_args: '--env-file=.env',

    instances: workers,
    // cluster mode shares the listening socket across workers; fork mode cannot.
    exec_mode: workers > 1 ? 'cluster' : 'fork',

    autorestart: true,
    max_restarts: 10,
    min_uptime: '20s',          // restarts inside this window count as crashes
    restart_delay: 2000,
    max_memory_restart: '512M', // per worker
    kill_timeout: 5000,         // let in-flight requests finish on reload

    // Do not watch files: deploys are explicit via deploy.sh. Watching a
    // network/shared filesystem also causes spurious restart loops.
    watch: false,

    time: true,                 // timestamp every log line
    merge_logs: true,           // one log file, not one per worker
    out_file: __dirname + '/logs/ll-manager.out.log',
    error_file: __dirname + '/logs/ll-manager.err.log',

    env: {
      NODE_ENV: 'development',
      CLUSTERED: workers > 1 ? '1' : '0',
    },
    env_production: {
      NODE_ENV: 'production',
      CLUSTERED: workers > 1 ? '1' : '0',
    },
  }],
}
