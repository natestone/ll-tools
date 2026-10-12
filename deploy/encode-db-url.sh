#!/usr/bin/env bash
# Build a correctly percent-encoded DATABASE_URL.
#
#   ./deploy/encode-db-url.sh
#
# Prompts for the parts separately so the password never has to be escaped by
# hand, and prints the line to paste into app/backend/.env.
set -euo pipefail

read -rp "DB host [127.0.0.1]: " HOST; HOST="${HOST:-127.0.0.1}"
read -rp "DB port [3306]: "      PORT; PORT="${PORT:-3306}"
read -rp "DB name: "             NAME
read -rp "DB user: "             USER
read -rsp "DB password: "        PASS; echo

HOST="$HOST" PORT="$PORT" NAME="$NAME" USER="$USER" PASS="$PASS" python3 - <<'PY'
import os, urllib.parse as u
# safe="" so every reserved character is encoded, including ? / # @ : %
enc = lambda s: u.quote(s, safe="")
url = (f"mysql://{enc(os.environ['USER'])}:{enc(os.environ['PASS'])}"
       f"@{os.environ['HOST']}:{os.environ['PORT']}/{os.environ['NAME']}")
print("\nPaste this into app/backend/.env:\n")
print(f'DATABASE_URL="{url}"\n')
# Prove it round-trips before anyone relies on it.
d = u.urlparse(url)
assert u.unquote(d.password) == os.environ['PASS'], "encoding round-trip failed"
print(f"verified: host={d.hostname} port={d.port} db={d.path.lstrip('/')} "
      f"user={u.unquote(d.username)} password round-trips exactly")
PY
