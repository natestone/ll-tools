#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy the latest code.
#
#   ./deploy/deploy.sh                 # pull, migrate, build, reload
#   ./deploy/deploy.sh --no-pull       # deploy what is already checked out
#   ./deploy/deploy.sh --skip-backup   # faster; only if you just took one
#
# Order matters and is deliberate:
#   back up -> pull -> install -> generate -> MIGRATE -> BUILD -> reload
#
# Migrations run before the new code starts serving, so the schema is never
# behind the code that expects it. The front end is built before the reload so
# the swap to new assets happens in one step rather than serving a half-built
# directory. If any step fails the script stops and the old version keeps
# running, because nothing has been reloaded yet.
# ---------------------------------------------------------------------------
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-ll-manager}"
DO_PULL=1
DO_BACKUP=1

# Read PORT from the env file the app actually uses, so a non-default port does
# not leave the health check polling 3001 and declaring a healthy deploy dead.
APP_PORT="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?PORT[[:space:]]*=[[:space:]]*"\?\([0-9]\+\)"\?.*/\2/p' \
  "$ROOT/app/backend/.env" 2>/dev/null | tail -1)"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT:-3001}/api/health}"

for arg in "$@"; do
  case "$arg" in
    --no-pull)     DO_PULL=0 ;;
    --skip-backup) DO_BACKUP=0 ;;
    -h|--help)     sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; }
trap 'fail "deploy aborted on line $LINENO — the previous version is still running"' ERR

cd "$ROOT"

# --- 0. sanity ------------------------------------------------------------
[ -f app/backend/.env ] || { echo "Missing app/backend/.env — copy .env.example and fill it in." >&2; exit 1; }
command -v pm2 >/dev/null || { echo "pm2 is not installed: npm i -g pm2" >&2; exit 1; }

# --- 1. back up the database ---------------------------------------------
# Before migrations, not after: this is the copy you restore from if a
# migration does something unexpected.
if [ "$DO_BACKUP" = 1 ]; then
  say "Backing up the database"
  "$ROOT/deploy/db-dump.sh"
else
  say "Skipping database backup (--skip-backup)"
fi

# --- 2. get the code ------------------------------------------------------
if [ "$DO_PULL" = 1 ]; then
  say "Pulling latest code"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  # Refuse to deploy over uncommitted edits rather than silently stashing or
  # clobbering them -- on a server they are usually an emergency hotfix.
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is dirty. Commit, stash or revert before deploying:" >&2
    git status --short >&2
    exit 1
  fi
  BEFORE="$(git rev-parse HEAD)"
  git pull --ff-only origin "$BRANCH"
  AFTER="$(git rev-parse HEAD)"
  if [ "$BEFORE" = "$AFTER" ]; then
    echo "    already up to date at ${AFTER:0:8}"
  else
    echo "    ${BEFORE:0:8} -> ${AFTER:0:8}"
    git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
  fi
fi

# --- 3. dependencies ------------------------------------------------------
# `npm ci` installs exactly what package-lock.json pins and removes anything
# else, so the server cannot drift from what was tested.
say "Installing dependencies"
cd "$ROOT/app"
npm ci --no-audit --no-fund

# --- 4. prisma client -----------------------------------------------------
# Regenerate before migrating: the client must match the schema the new code
# imports, and generation is what fails loudly if the schema is malformed.
say "Generating Prisma client"
npm --workspace backend run generate

# --- 5. migrations --------------------------------------------------------
# `migrate deploy` only applies migrations that are committed to the repo. It
# never prompts and never resets, so it is safe to run unattended; if a
# migration would lose data it fails instead of guessing.
say "Applying database migrations"
npm --workspace backend run migrate:deploy

# --- 6. build the client --------------------------------------------------
say "Building the front end"
npm --workspace frontend run build
[ -f "$ROOT/app/frontend/dist/index.html" ] || { echo "Build produced no index.html" >&2; exit 1; }

# --- 7. restart -----------------------------------------------------------
# `reload` is zero-downtime in cluster mode and a quick restart in fork mode;
# `startOrReload` also covers the case where the app is not running yet.
say "Reloading PM2"
cd "$ROOT"
pm2 startOrReload ecosystem.config.cjs --env production --update-env
pm2 save --force >/dev/null

# --- 8. prove it is actually up -------------------------------------------
say "Health check"
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "    healthy at $HEALTH_URL"
    trap - ERR
    say "Deployed $(git rev-parse --short HEAD) — done"
    exit 0
  fi
  sleep 1
done

fail "the app did not become healthy within 20s"
echo "Recent logs:" >&2
pm2 logs "$APP_NAME" --lines 40 --nostream >&2 || true
exit 1
