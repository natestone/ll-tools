# Deploying League Manager

Rollout notes for putting this app on a production server, carrying the current
database over as-is, and shipping updates afterwards.

- **§1** What runs where
- **§2** Server prerequisites
- **§3** Database and user
- **§4** First deploy — carrying the existing data across
- **§5** Apache reverse proxy + TLS
- **§6** Amazon SES, so email actually sends
- **§7** Verify the rollout
- **§8** Shipping updates afterwards
- **§9** How migrations work — read this before changing the schema
- **§10** Backups, logs, and when things break

---

## 1. What runs where

One PM2 process, `ll-manager`, serves both the JSON API and the built front end
from the same origin.

```
browser ──https──> apache :443 ──http──> node :3001 ──> MySQL :3306
                                 │
                                 ├─ /api/*  JSON API
                                 └─ /*      app/frontend/dist (SPA)
```

Serving the client from the same process is deliberate. Cross-origin session
cookies need `SameSite=None; Secure` and are dropped outright by some mobile
browsers' tracking protection — exactly the phones board members use. One origin
avoids that whole category of problem, and there is a single service to watch.

| Piece | Where |
|---|---|
| Process manager | PM2, config in `ecosystem.config.cjs` |
| API + client | `app/backend/src/index.js` on `PORT` (default 3001) |
| Client build | `app/frontend/dist`, built by `vite build` |
| Sessions | MySQL `sessions` table (survives restarts) |
| Secrets | `app/backend/.env` — never committed |
| Logs | `logs/ll-manager.{out,err}.log` |

---

## 2. Server prerequisites

Ubuntu 22.04/24.04 or similar.

```bash
# Node 20 LTS (the app uses --env-file, which needs >= 20.6)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs mysql-server apache2 git

# the reverse proxy needs these four modules
sudo a2enmod proxy proxy_http headers deflate
sudo systemctl restart apache2
sudo npm install -g pm2

node -v        # must be >= 20.6
```

Create a non-root user to own the app, and check it out:

```bash
sudo adduser --system --group --home /srv/ll-manager ll-manager
sudo -u ll-manager git clone <your-repo-url> /srv/ll-manager
```

Everything below runs as that user from `/srv/ll-manager`.

---

## 3. Database and user

The app's DB user needs DDL rights as well as DML, because `prisma migrate
deploy` alters the schema on release. It should **not** have `CREATE DATABASE`.

```sql
CREATE DATABASE ll_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'll_manager'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, ALTER, DROP, INDEX, REFERENCES
  ON ll_manager.* TO 'll_manager'@'localhost';
FLUSH PRIVILEGES;
```

`utf8mb4` is not optional — league content contains `·`, em dashes and curly
quotes, and `utf8` (MySQL's 3-byte alias) mangles them.

Then write the environment file:

```bash
cd /srv/ll-manager/app/backend
cp .env.example .env
chmod 600 .env          # it holds the DB password and SES credentials
openssl rand -base64 48 # once for SESSION_SECRET, again for MAIL_SECRET
$EDITOR .env
```

Leave `MAIL_DRIVER=console` for now — mail is wired up in §6, after the app is
confirmed working. Nothing is sent to real people in the meantime.

---

## 4. First deploy — carrying the existing data across

### 4.1 Dump the current database

On the **old** machine, as close to cutover as you can manage:

```bash
./deploy/db-dump.sh
# -> backups/gngrll_dev-20261012-203643.sql.gz
```

The dump carries every table and row except two, both deliberate:

- `sessions` — structure only. Everyone signs in again on the new host.
- `PasswordReset` — structure only. One-time tokens shouldn't migrate; a pending
  reset is simply re-requested.

It contains real names, email addresses and password hashes. Move it with `scp`.
**Do not commit it** — `backups/` is gitignored for this reason.

```bash
scp backups/gngrll_dev-*.sql.gz you@server:/tmp/
```

### 4.2 Import and start

On the **new** server:

```bash
cd /srv/ll-manager
./deploy/first-deploy.sh /tmp/gngrll_dev-20261012-203643.sql.gz
```

That script installs dependencies, imports the dump, **baselines the migration
history** (see §9 — this is the step that is easy to get wrong), builds the
front end, and starts PM2.

To start with an empty database instead, use `./deploy/first-deploy.sh --empty`.

### 4.3 Survive a reboot

```bash
pm2 startup        # prints a sudo command — run it
pm2 save
```

Without this the app does not come back after the server restarts.

---

## 5. Apache reverse proxy + TLS

Apache terminates TLS and proxies everything to the app. Nothing is served from
disk by Apache — the Node process serves both the API and the client — so there
is no `DocumentRoot` to keep in sync and no static aliasing to get wrong.

```bash
sudo a2enmod proxy proxy_http headers deflate
```

`/etc/apache2/sites-available/ll-manager.conf`:

```apache
<VirtualHost *:80>
    ServerName ll-manager.org

    # certbot rewrites this into a redirect to https. Leave it plain for now so
    # the first certificate issuance has a working http vhost to validate.
    DocumentRoot /var/www/html
    ErrorLog  ${APACHE_LOG_DIR}/ll-manager-error.log
    CustomLog ${APACHE_LOG_DIR}/ll-manager-access.log combined
</VirtualHost>

<VirtualHost *:443>
    ServerName ll-manager.org

    SSLEngine on
    # certbot fills in the certificate paths and the hardening include.

    # ---- reverse proxy ---------------------------------------------------
    # Never a forward proxy. Off by default; stated because an open proxy on a
    # public box gets found and abused within hours.
    ProxyRequests Off
    ProxyPreserveHost On

    ProxyPass        / http://127.0.0.1:3001/ connectiontimeout=5 timeout=60
    ProxyPassReverse / http://127.0.0.1:3001/

    # ---- the header everything depends on --------------------------------
    # mod_proxy_http sets X-Forwarded-For and X-Forwarded-Host on its own, but
    # NOT X-Forwarded-Proto. Without this line Express (which has `trust proxy`
    # set) believes the request arrived over plain http, refuses to set the
    # Secure session cookie, and logins silently never stick -- no error
    # anywhere, the user just bounces back to the login page.
    RequestHeader set X-Forwarded-Proto "https"

    # ---- compression -----------------------------------------------------
    # The client bundle is ~528K of JavaScript and gzips to ~168K, a 69%
    # saving measured on this build. Images and fonts are already compressed.
    AddOutputFilterByType DEFLATE text/html text/plain text/css text/javascript
    AddOutputFilterByType DEFLATE application/javascript application/json
    AddOutputFilterByType DEFLATE image/svg+xml

    # The API accepts 2MB JSON bodies; leave headroom, reject the absurd.
    LimitRequestBody 4194304

    ErrorLog  ${APACHE_LOG_DIR}/ll-manager-error.log
    CustomLog ${APACHE_LOG_DIR}/ll-manager-access.log combined
</VirtualHost>
```

Enable it and issue the certificate:

```bash
sudo a2ensite ll-manager
sudo apache2ctl configtest          # must say "Syntax OK"
sudo systemctl reload apache2

sudo certbot --apache -d ll-manager.org
```

certbot writes the certificate paths into the `*:443` vhost, adds the hardening
include, and offers to redirect http to https — accept it. Renewal is installed
as a systemd timer; confirm with `sudo certbot renew --dry-run`.

> **If you let certbot create the SSL vhost for you** (by running it against an
> http-only vhost), check that `RequestHeader set X-Forwarded-Proto "https"`
> ended up in the `*:443` block. certbot copies the http vhost, and a
> `ProxyPass` without that header is the single most common way this deployment
> breaks.

Once TLS is live, set `COOKIE_SECURE=1` and `APP_URL=https://ll-manager.org` in
`app/backend/.env`, then `pm2 restart ll-manager --update-env`.

### Why these two headers matter

Verified behind this exact config:

| | Through Apache | Straight to :3001 |
|---|---|---|
| `req.protocol` | `https` | `http` |
| `req.secure` | `true` | `false` |
| `X-Forwarded-For` | the real client IP | absent |

`req.secure` is what lets the Secure session cookie be set at all. `X-Forwarded-For`
is what the All-Star signup form records as the IP that signed a consent
agreement — without it every signature is logged as coming from `127.0.0.1`,
which makes the record worthless if it is ever questioned.

The app sets `trust proxy` to **1**, meaning it trusts exactly one hop. That is
correct for Apache on the same box. If you ever put Cloudflare or another proxy
in front of Apache, raise it to match, or the client IP recorded will be the
intermediate proxy's.

### nginx instead

Nothing here is Apache-specific — the app is a plain HTTP server on
`127.0.0.1:3001`. The nginx equivalent:

```nginx
server {
    server_name ll-manager.org;
    client_max_body_size 4m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

---

## 6. Amazon SES

Until this is done, `MAIL_DRIVER=console` means the app writes messages to the
log and sends nothing. Password resets, invitations, All-Star ballot links and
signup receipts all stop at the log file.

`docs/EMAIL_SETUP.md` explains how the mailer works internally; this section is
the rollout checklist.

### 6.1 Verify the domain

1. AWS console → **Amazon SES** → choose a region (e.g. `us-east-1`) and **stay
   in it**. Identities and SMTP credentials are per-region, and credentials made
   in one region fail in another.
2. **Identities → Create identity → Domain**, enter `ll-manager.org`.
3. Leave **Easy DKIM** on (RSA 2048). SES returns **three CNAME records**.
4. Publish those three CNAMEs in DNS. Verification flips to *Verified* within
   minutes to a few hours.

### 6.2 Leave the sandbox — do not skip this

New SES accounts are sandboxed: you may only send to addresses you have verified,
capped at 200 messages/day. Password resets to real board members simply fail.

**Account dashboard → Request production access.** Describe it honestly:
transactional only — password resets, league invitations and All-Star ballots, to
people who asked for an account; no marketing. Usually approved within 24 hours.

Request this early. It is the one step with a waiting period attached, and the
rollout is not finished until it clears.

### 6.3 Create SMTP credentials

**SES → SMTP settings → Create SMTP credentials.** This creates an IAM user with
`ses:SendRawEmail` and returns an SMTP username and password.

That SMTP password is **not** your AWS secret access key — it is derived from it,
and it is **shown exactly once**. Download the CSV. If you lose it, delete the
credential and make a new one.

### 6.4 Point the app at it

In `app/backend/.env`:

```ini
MAIL_DRIVER=smtp
SMTP_HOST=email-smtp.us-east-1.amazonaws.com    # must match your SES region
SMTP_PORT=587
SMTP_USER=<from the CSV>
SMTP_PASS=<from the CSV>

MAIL_FROM="G·NG·R Little League <no-reply@ll-manager.org>"
MAIL_REPLY_TO="board@ll-manager.org"
```

`MAIL_FROM` must be an address **at the verified domain**. It need not be a real
mailbox. `MAIL_REPLY_TO` should be one a human reads, or replies vanish — the
All-Star signup receipt explicitly tells parents to reply if something is wrong.

### 6.5 DNS for deliverability

| Record | Host | Value |
|---|---|---|
| CNAME ×3 | provided by SES | Easy DKIM, from §6.1 |
| TXT (SPF) | `@` | `v=spf1 include:amazonses.com ~all` |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@ll-manager.org` |

Publish exactly **one** SPF record. Multiple SPF TXT records are a hard fail — if
the domain already has one, merge `include:amazonses.com` into it rather than
adding a second.

Start DMARC at `p=none`, read the reports for a couple of weeks, then tighten to
`quarantine` and eventually `reject`.

### 6.6 Confirm

```bash
pm2 restart ll-manager --update-env
pm2 logs ll-manager --lines 20
```

Look for the mailer line on boot — it proves the credentials work before anyone
needs them:

```
[mail] driver=smtp ready, sending as G·NG·R Little League <no-reply@ll-manager.org>
```

Then use **Forgot password?** with your own address and confirm it arrives.

**Watch bounces.** SES suspends accounts with high bounce or complaint rates.
Invitations go to hand-typed addresses, which is exactly how bounces happen.

---

## 7. Verify the rollout

```bash
curl -fsS https://ll-manager.org/api/health            # {"ok":true}
curl -sI  https://ll-manager.org/ | grep -i cache      # no-cache on the shell
curl -s   https://ll-manager.org/api/nope              # {"error":"not found"}
```

Then in a browser:

- [ ] Log in as the super admin and land on the dashboard
- [ ] The session survives a reload (cookie is being set — check `Secure` is on)
- [ ] A league page lists its tasks
- [ ] "Forgot password?" delivers a real email (after §6)
- [ ] An All-Star public signup link loads and submits
- [ ] `pm2 restart ll-manager` and confirm you are still logged in
      (sessions live in MySQL, so they survive)

---

## 8. Shipping updates afterwards

Commit and push on your machine, then on the server:

```bash
cd /srv/ll-manager
./deploy/deploy.sh
```

That does, in this order:

1. **Back up the database** — before migrations, so there is something to restore
2. **Pull** — `--ff-only`, and it refuses to run if the working tree is dirty
3. **`npm ci`** — installs exactly what the lockfile pins
4. **`prisma generate`** — client matches the schema the new code imports
5. **`prisma migrate deploy`** — applies pending migrations
6. **`vite build`** — new front end assets
7. **`pm2 startOrReload`**
8. **Health check** — polls `/api/health` for 20s and dumps logs if it never comes up

If any step fails the script stops before the reload, so the previous version
keeps serving.

```bash
./deploy/deploy.sh --no-pull        # deploy what is already checked out
./deploy/deploy.sh --skip-backup    # only if you just took one
```

---

## 9. How migrations work — read before changing the schema

This project was developed with `prisma db push`, which edits the database to
match `schema.prisma` and keeps no history. That is fine for one developer and
unusable for a production box, so the schema is now managed by **migrations**.

**`prisma db push` must not be run against production.** It can silently drop a
column — and the data in it — to make the database match the schema.

### The baseline

`prisma/migrations/0_init/` describes the entire schema as it stood at rollout.
The production database already has those tables (they came in with the dump), so
the migration is recorded as applied rather than run:

```bash
npm --workspace backend run migrate:baseline
```

`first-deploy.sh` does this for you, and skips it if the dump already carried a
migration history. Running `migrate deploy` without it fails with "table already
exists", which is the error this step exists to prevent.

### Changing the schema from here on

On your **development** machine:

```bash
cd app/backend
$EDITOR prisma/schema.prisma
npx prisma migrate dev --name add_whatever_it_is
```

That writes `prisma/migrations/<timestamp>_add_whatever_it_is/migration.sql` and
applies it locally. **Commit the migration directory** — it is how the change
reaches production. `deploy.sh` then applies it on the server.

### If `migrate dev` says it cannot create a shadow database

`migrate dev` builds a temporary "shadow" database to work out the diff, which
needs `CREATE DATABASE`. Application DB users deliberately do not have that, and
you will get:

```
Error: P3014  User `...` was denied access on the database `...`
```

Two ways out. Either grant your **local** user the right (never the production
one):

```sql
GRANT ALL PRIVILEGES ON `prisma_migrate_shadow_db%`.* TO 'youruser'@'localhost';
```

…or author the migration without a shadow database at all:

```bash
cd app/backend
mkdir -p "prisma/migrations/$(date -u +%Y%m%d%H%M%S)_add_whatever_it_is"
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "prisma/migrations/<that same dir>/migration.sql"
npx prisma migrate deploy        # applies it locally
```

**Read the generated SQL before committing it.** `migrate diff` writes what makes
the database match the schema, which for a renamed column is a `DROP` plus an
`ADD` — correct by its own logic, and total data loss for that column. Rewrite it
as a `RENAME` by hand when that happens.

`migrate deploy` — what production runs — never needs a shadow database.

### Checking state

```bash
npm --workspace backend run migrate:status
```

---

## 10. Backups, logs, and when things break

### Backups

`deploy.sh` dumps the database before every deploy. That covers deploys, not
disks. Add a nightly cron as the app user:

```cron
15 2 * * * cd /srv/ll-manager && ./deploy/db-dump.sh >> logs/backup.log 2>&1
45 2 * * * find /srv/ll-manager/backups -name '*.sql.gz' -mtime +30 -delete
```

A backup nobody has restored is a hypothesis. Once, restore one into a scratch
database and look at it:

```bash
mysql -u root -e "CREATE DATABASE restore_test"
gunzip -c backups/ll_manager-<stamp>.sql.gz | mysql -u root restore_test
mysql -u root restore_test -e "SELECT COUNT(*) FROM Task; SELECT COUNT(*) FROM User;"
mysql -u root -e "DROP DATABASE restore_test"
```

### Logs

```bash
pm2 logs ll-manager            # live
pm2 logs ll-manager --lines 200 --nostream
pm2 status
```

PM2 does not rotate logs by default, and these grow forever:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
```

### When things break

| Symptom | Cause |
|---|---|
| Login never sticks | `COOKIE_SECURE=1` without TLS, or the proxy not sending `X-Forwarded-Proto` (§5) |
| 502/503 from Apache | Node is down — `pm2 status`, then `pm2 logs` |
| Emailed links point at localhost | `APP_URL` is wrong in `.env` |
| No email, no error | `MAIL_DRIVER` still `console`, or the recipient is on the unsubscribe list |
| "table already exists" on deploy | The baseline was never recorded — §9 |
| App serves old assets after deploy | A cached `index.html`; it is sent `no-cache`, so suspect a proxy in front |
| Everyone signed out after deploy | `SESSION_SECRET` changed |

Rolling back code is `git checkout <previous-tag> && ./deploy/deploy.sh --no-pull`.
Rolling back a **migration** is not automatic — restore the pre-deploy dump that
`deploy.sh` took.
