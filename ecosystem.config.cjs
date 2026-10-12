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
 */
module.exports = {
  apps: [{
    name: 'll-manager',
    cwd: __dirname + '/app/backend',
    script: 'src/index.js',
    // --env-file keeps one source of truth for configuration between
    // `npm start`, a manual run and PM2.
    node_args: '--env-file=.env',

    /* Single instance, not cluster mode. The session store is in MySQL so
       clustering would work, but this app serves one league board -- extra
       workers would buy nothing and multiply the connection pool. Revisit if
       traffic ever justifies it. */
    instances: 1,
    exec_mode: 'fork',

    autorestart: true,
    max_restarts: 10,
    min_uptime: '20s',          // restarts inside this window count as crashes
    restart_delay: 2000,
    max_memory_restart: '512M',

    // Do not watch files: deploys are explicit via deploy.sh. Watching a
    // network/shared filesystem also causes spurious restart loops.
    watch: false,

    time: true,                 // timestamp every log line
    merge_logs: true,
    out_file: __dirname + '/logs/ll-manager.out.log',
    error_file: __dirname + '/logs/ll-manager.err.log',

    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
  }],
}
