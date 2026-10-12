#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-time production setup. Run AFTER you have:
#   1. created the database and its user (docs/DEPLOYMENT.md §3)
#   2. copied app/backend/.env.example to .env and filled it in
#   3. copied the .sql.gz dump from the old machine onto this one
#
#   ./deploy/first-deploy.sh /path/to/gngrll_dev-20261012-203643.sql.gz
#   ./deploy/first-deploy.sh --empty          # start with no data instead
#   ./deploy/first-deploy.sh --skip-import    # database is already loaded
#
# --skip-import is for when you imported the dump by hand. Everything else
# still needs doing: dependencies, the Prisma client, the migration baseline,
# the client build and the PM2 service.
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
[ -n "$DUMP" ] || { echo "Usage: $0 <dump.sql.gz> | --empty | --skip-import" >&2; exit 2; }

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
trap 'printf "\n\033[1;31mFAILED on line %s\033[0m\n" "$LINENO" >&2' ERR

cd "$ROOT"
[ -f app/backend/.env ] || { echo "Missing app/backend/.env — copy .env.example and fill it in." >&2; exit 1; }

source "$ROOT/deploy/lib-dburl.sh"
parse_database_url "$ROOT/app/backend/.env" || exit 1

CNF="$(mysql_defaults_file)"; trap 'rm -f "$CNF"' EXIT

say "Checking the database connection"
mysql --defaults-extra-file="$CNF" -e "SELECT 1" "$DB_NAME" >/dev/null
echo "    connected to $DB_NAME on $DB_HOST"

say "Installing dependencies"
cd "$ROOT/app" && npm ci --no-audit --no-fund
npm --workspace backend run generate

# The tables already exist (they came in with the dump), so 0_init is recorded
# as applied rather than run -- running it would fail on "table already exists".
# A dump taken from a host that was already migration-managed brings its own
# history, in which case there is nothing to baseline.
baseline_and_migrate() {
  HAS_HISTORY="$(mysql --defaults-extra-file="$CNF" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='_prisma_migrations'")"
  cd "$ROOT/app"
  if [ "$HAS_HISTORY" = "0" ]; then
    say "Baselining the migration history"
    npm --workspace backend run migrate:baseline
  else
    APPLIED="$(mysql --defaults-extra-file="$CNF" -N -B -e \
      "SELECT COUNT(*) FROM \`$DB_NAME\`._prisma_migrations WHERE migration_name='0_init'")"
    if [ "$APPLIED" = "0" ]; then
      say "Baselining the migration history"
      npm --workspace backend run migrate:baseline
    else
      say "Migration history already present — skipping baseline"
    fi
  fi

  say "Applying any later migrations"
  npm --workspace backend run migrate:deploy
}

TABLES_NOW() {
  mysql --defaults-extra-file="$CNF" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME'"
}

case "$DUMP" in
  --empty)
    say "Creating the schema from migrations (no data)"
    cd "$ROOT/app" && npm --workspace backend run migrate:deploy
    ;;

  --skip-import)
    # Trust but verify: an empty database here means the import did not land,
    # and carrying on would build a schema with none of the league's data.
    EXISTING="$(TABLES_NOW)"
    if [ "$EXISTING" = "0" ]; then
      echo "Database '$DB_NAME' has no tables — the import did not succeed." >&2
      echo "Import the dump first, or re-run without --skip-import." >&2
      exit 1
    fi
    say "Using the existing database ($EXISTING tables already present)"
    baseline_and_migrate
    ;;

  *)
    [ -f "$DUMP" ] || { echo "No such dump: $DUMP" >&2; exit 1; }

    EXISTING="$(TABLES_NOW)"
    if [ "$EXISTING" != "0" ]; then
      echo "Database '$DB_NAME' already has $EXISTING tables. Refusing to import over it." >&2
      echo "If it is already loaded, re-run with --skip-import instead." >&2
      exit 1
    fi

    say "Importing $(basename "$DUMP")"
    # Detect compression by magic bytes, not by filename: a dump renamed
    # without its .gz piped straight into mysql produces the baffling
    # "ASCII '\0' appeared in the statement" error.
    if [ "$(head -c2 "$DUMP" | od -An -tx1 | tr -d ' ')" = "1f8b" ]; then
      gunzip -c "$DUMP"
    else
      cat "$DUMP"
    fi | mysql --defaults-extra-file="$CNF" "$DB_NAME"

    echo "    imported $(TABLES_NOW) tables"
    baseline_and_migrate
    ;;
esac

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
  - Apache reverse proxy + TLS          (§5)
  - Amazon SES, so email actually sends (§6)
  - verify the rollout                  (§7)
DONE
