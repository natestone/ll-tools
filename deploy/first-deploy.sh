#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-time production setup. Run AFTER you have:
#   1. created the database and its user (docs/DEPLOYMENT.md §3)
#   2. copied app/backend/.env.example to .env and filled it in
#   3. copied the .sql.gz dump from the old machine onto this one
#
#   ./deploy/first-deploy.sh /path/to/gngrll_dev-20261012-203643.sql.gz
#   ./deploy/first-deploy.sh --empty      # start with no data instead
#
# The subtle part is the migration baseline. The dump already contains every
# table, so running `migrate deploy` against it would try to CREATE TABLE on
# tables that exist and fail. Instead the 0_init migration is recorded as
# already-applied, which is exactly what it is. Every migration added after
# this point then applies normally.
# ---------------------------------------------------------------------------
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="${1:-}"
[ -n "$DUMP" ] || { echo "Usage: $0 <dump.sql.gz> | --empty" >&2; exit 2; }

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
trap 'printf "\n\033[1;31mFAILED on line %s\033[0m\n" "$LINENO" >&2' ERR

cd "$ROOT"
[ -f app/backend/.env ] || { echo "Missing app/backend/.env — copy .env.example and fill it in." >&2; exit 1; }

eval "$(
  ENV_FILE="$ROOT/app/backend/.env" python3 - <<'PY'
import os, re, urllib.parse as u
url = None
for line in open(os.environ['ENV_FILE']):
    m = re.match(r'\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)', line)
    if m: url = m.group(1).strip().strip('"').strip("'")
if not url: raise SystemExit('DATABASE_URL not found')
d = u.urlparse(url)
def q(s): return "'" + str(s).replace("'", "'\\''") + "'"
print(f'DB_HOST={q(d.hostname or "localhost")}'); print(f'DB_PORT={q(d.port or 3306)}')
print(f'DB_USER={q(u.unquote(d.username or ""))}'); print(f'DB_PASS={q(u.unquote(d.password or ""))}')
print(f'DB_NAME={q(d.path.lstrip("/").split("?")[0])}')
PY
)"

CNF="$(mktemp)"; chmod 600 "$CNF"; trap 'rm -f "$CNF"' EXIT
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' \
  "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASS" > "$CNF"

say "Checking the database connection"
mysql --defaults-extra-file="$CNF" -e "SELECT 1" "$DB_NAME" >/dev/null
echo "    connected to $DB_NAME on $DB_HOST"

say "Installing dependencies"
cd "$ROOT/app" && npm ci --no-audit --no-fund
npm --workspace backend run generate

if [ "$DUMP" = "--empty" ]; then
  say "Creating the schema from migrations (no data)"
  npm --workspace backend run migrate:deploy
else
  [ -f "$DUMP" ] || { echo "No such dump: $DUMP" >&2; exit 1; }

  EXISTING="$(mysql --defaults-extra-file="$CNF" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME'")"
  if [ "$EXISTING" != "0" ]; then
    echo "Database '$DB_NAME' already has $EXISTING tables. Refusing to import over it." >&2
    echo "Drop and recreate it first if this is really what you want." >&2
    exit 1
  fi

  say "Importing $(basename "$DUMP")"
  case "$DUMP" in
    *.gz) gunzip -c "$DUMP" ;;
    *)    cat "$DUMP" ;;
  esac | mysql --defaults-extra-file="$CNF" "$DB_NAME"

  COUNT="$(mysql --defaults-extra-file="$CNF" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME'")"
  echo "    imported $COUNT tables"

  # The tables are already there, so record the baseline rather than running
  # it. A dump taken from a host that was already migration-managed brings its
  # own history, in which case there is nothing to baseline.
  HAS_HISTORY="$(mysql --defaults-extra-file="$CNF" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='_prisma_migrations'")"
  cd "$ROOT/app"
  if [ "$HAS_HISTORY" = "0" ]; then
    say "Baselining the migration history"
    npm --workspace backend run migrate:baseline
  else
    say "Dump already carries migration history — skipping baseline"
  fi

  # Anything committed after the baseline still needs applying.
  say "Applying any later migrations"
  npm --workspace backend run migrate:deploy
fi

say "Migration status"
cd "$ROOT/app" && npm --workspace backend run migrate:status || true

say "Building the front end"
npm --workspace frontend run build

say "Starting under PM2"
cd "$ROOT"
pm2 startOrReload ecosystem.config.cjs --env production --update-env
pm2 save --force >/dev/null

cat <<'DONE'

Set PM2 to come back after a reboot (prints a command to run with sudo):

    pm2 startup
    # run the line it prints, then:
    pm2 save

Then finish the checklist in app/docs/DEPLOYMENT.md:
  - nginx reverse proxy + TLS           (§4)
  - Amazon SES, so email actually sends (§5)
  - verify the rollout                  (§7)
DONE
