#!/usr/bin/env bash
# Dump the application database to a timestamped .sql.gz.
#
# Run this against the machine you are migrating FROM, as close to cutover as
# you can: a dump taken days earlier is days of lost edits.
#
#   ./deploy/db-dump.sh                 # dump the DB in app/backend/.env
#   ENV_FILE=/path/to/.env ./deploy/db-dump.sh
#
# The output is written to backups/, which is gitignored on purpose -- it
# contains real names, email addresses and password hashes. Move it with scp,
# never by committing it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/app/backend/.env}"
OUT_DIR="${OUT_DIR:-$ROOT/backups}"

[ -f "$ENV_FILE" ] || { echo "No env file at $ENV_FILE" >&2; exit 1; }

# Parse DATABASE_URL rather than asking for the parts again -- one source of truth.
source "$ROOT/deploy/lib-dburl.sh"
parse_database_url "$ENV_FILE" || exit 1

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/${DB_NAME}-${STAMP}.sql.gz"

# Credentials go in a 0600 file, never on the command line, where every other
# user on the box could read them out of `ps`.
CNF="$(mysql_defaults_file)"
trap 'rm -f "$CNF"' EXIT

echo "Dumping $DB_NAME from $DB_HOST ..."

# --single-transaction    consistent snapshot without locking the site
# --no-tablespaces        avoids needing the PROCESS privilege
# --set-gtid-purged=OFF   the dump is a seed, not a replica
#
# sessions and PasswordReset carry structure but no rows: live logins and
# one-time reset tokens are deliberately not migrated. Everyone signs in again
# on the new host, and a pending reset is simply re-requested.
COMMON=(--defaults-extra-file="$CNF" --single-transaction --no-tablespaces
        --set-gtid-purged=OFF --routines --triggers --events --hex-blob)
SKIP_DATA=(sessions PasswordReset)

IGNORE=()
for t in "${SKIP_DATA[@]}"; do IGNORE+=(--ignore-table="$DB_NAME.$t"); done

{
  # everything except the two ephemeral tables ...
  mysqldump "${COMMON[@]}" "${IGNORE[@]}" "$DB_NAME"
  # ... then those two as empty structure, so their rows are never written to
  # the file in the first place rather than being overwritten later in it.
  mysqldump "${COMMON[@]}" --no-data "$DB_NAME" "${SKIP_DATA[@]}"
} | gzip > "$OUT"

echo "Wrote $OUT  ($(du -h "$OUT" | cut -f1))"
echo
echo "Restore on the target host with:"
echo "  gunzip -c $(basename "$OUT") | mysql -u <user> -p <database>"
