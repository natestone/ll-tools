# Shared DATABASE_URL parser, sourced by the deploy scripts.
#
# Sets DB_HOST DB_PORT DB_USER DB_PASS DB_NAME from the DATABASE_URL in an env
# file. Exists mainly to fail comprehensibly: an unencoded character in the
# password produces a Python traceback and then "DB_PORT: unbound variable",
# which says nothing about the actual problem.
#
#   source "$ROOT/deploy/lib-dburl.sh"
#   parse_database_url "$ROOT/app/backend/.env"

parse_database_url() {
  local env_file="$1" parsed rc
  [ -f "$env_file" ] || { echo "No env file at $env_file" >&2; return 1; }

  parsed="$(ENV_FILE="$env_file" python3 - <<'PY'
import os, re, sys, urllib.parse as u

url = None
for line in open(os.environ['ENV_FILE']):
    m = re.match(r'\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)', line)
    if m:
        url = m.group(1).strip().strip('"').strip("'")
if not url:
    sys.exit('DATABASE_URL not found in the env file')

d = u.urlparse(url)

# ?, / and # terminate the netloc, so an unencoded one in the password silently
# truncates the host and the rest of the URL. Node's URL parser -- which the app
# itself uses for its session store -- rejects these outright, so the app would
# not start either. Catch it here with an explanation rather than a traceback.
try:
    port = d.port
except ValueError:
    sys.exit(
        "DATABASE_URL could not be parsed: the password almost certainly "
        "contains an unencoded ?, / or #.\n"
        "          These end the URL's authority section, so everything after "
        "is read as a path or query.\n"
        "          Percent-encode them in DATABASE_URL:  ? = %3F   / = %2F   "
        "# = %23   @ = %40   : = %3A   % = %25\n"
        "          (* and most other punctuation are fine.)\n"
        "          deploy/encode-db-url.sh will build the URL for you.")

if not d.hostname or not d.path.lstrip('/'):
    sys.exit("DATABASE_URL is missing a host or database name — check for "
             "unencoded characters in the password (see deploy/encode-db-url.sh)")

def q(s): return "'" + str(s).replace("'", "'\\''") + "'"
print(f'DB_HOST={q(d.hostname)}')
print(f'DB_PORT={q(port or 3306)}')
print(f'DB_USER={q(u.unquote(d.username or ""))}')
print(f'DB_PASS={q(u.unquote(d.password or ""))}')
print(f'DB_NAME={q(d.path.lstrip("/").split("?")[0])}')
PY
)"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "" >&2
    echo "  Could not read the database settings from $env_file" >&2
    echo "  $parsed" >&2
    return 1
  fi
  eval "$parsed"
}

# Write a 0600 defaults file so credentials never appear in `ps`.
mysql_defaults_file() {
  local f; f="$(mktemp)"; chmod 600 "$f"
  printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' \
    "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASS" > "$f"
  echo "$f"
}
