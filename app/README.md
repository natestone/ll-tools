# GNGRLL League Manager

A multi-tenant league-operations app for youth baseball/softball leagues: role-based
task "playbooks", email-template & agenda libraries, policies & procedures, a native
baseball scheduler, calendars, and an owner dashboard — seeded from the distilled
GNGRLL content and customizable per league.

**Stack:** React 18 + Vite (frontend) · Node.js + Express + Prisma (backend) · MySQL 8.
npm workspaces monorepo.

---

> **Deploying to a server?** See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — rollout,
> PM2, migrations, Amazon SES and `deploy/deploy.sh` for subsequent updates.

## Quick start

Prerequisites (already set up on this workstation): **Node 20+**, a running **MySQL 8**
with the `gngrll_dev` database, and installed dependencies.

```bash
cd /mnt/hgfs/development/gngrll/ll-manager/app
npm run dev
```

This starts both servers together with color-coded logs:

- `[api]` → **http://localhost:3001** (Express API)
- `[web]` → **http://localhost:5173** (Vite dev server; proxies `/api` → :3001)

Wait for `API listening on http://localhost:3001` and Vite's `Local: http://localhost:5173/`,
then open **http://localhost:5173**. Press **Ctrl+C** to stop both.

### Default login

| Email | Password |
|-------|----------|
| `nate@example.com` | `pw12345` |

This account owns the demo league **"Springfield Little League"**. You can also register
a new account from the login screen (it becomes the owner of any league it creates).

---

## Running the servers separately

If you prefer independent logs / terminals:

```bash
# Terminal 1 — API (:3001)
cd backend
npm run dev        # auto-reloads on file changes  (or: npm start)

# Terminal 2 — web (:5173)
cd frontend
npm run dev
```

---

## Project layout

```
app/
├── backend/            Express API + Prisma
│   ├── prisma/
│   │   ├── schema.prisma        # data model (leagues, roles, tasks, templates, ...)
│   │   ├── seed.js              # loads seed/gngrll/ into the Default* tables
│   │   └── backfill_league1.js  # one-off: enrich existing league 1
│   ├── src/
│   │   ├── index.js             # app entry + route mounting
│   │   ├── routes/              # auth, leagues, content, scheduler, permissions
│   │   ├── middleware/          # auth / league scoping
│   │   └── lib/                 # prisma, withLeague (tenant scoping), permissions, cloneSeed
│   └── .env                     # DATABASE_URL, SESSION_SECRET, PORT, CLIENT_ORIGIN, SEED_DIR
├── frontend/           React + Vite
│   ├── src/pages/               # Dashboard, RoleView, Tasks, Templates, Policies, Scheduler, Permissions, Members, ...
│   ├── src/scheduler/           # native scheduler engine + components
│   └── src/components/          # TaskItem (expandable playbook), Markdown, ...
└── package.json        # workspaces + combined `dev` script
```

Seed content lives outside `app/` at `../seed/gngrll/` (referenced by `SEED_DIR` in
`backend/.env`).

---

## Common commands

Run from `app/` unless noted.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start API + web together (recommended) |
| `npm --workspace backend run dev` | API only, with auto-reload |
| `npm --workspace frontend run dev` | Web only |
| `npm --workspace frontend run build` | Production build of the frontend |
| `npm --workspace backend run seed` | Reload the `Default*` seed tables from `seed/gngrll/` |
| `npm --workspace backend run migrate:dev` | Author + apply a migration after editing `schema.prisma` |
| `npm --workspace backend run migrate:deploy` | Apply pending migrations (what the server runs) |
| `npm --workspace backend run migrate:status` | Show which migrations are applied |
| `npm --workspace backend run generate` | Regenerate the Prisma client only |

> **Schema changes go through migrations now**, not `db push`. Edit `schema.prisma`, run
> `migrate:dev --name what_changed`, and **commit the generated
> `prisma/migrations/<timestamp>_*/` directory** — that is how the change reaches
> production, where `deploy.sh` applies it.
>
> ⚠️ `npm run push` (`prisma db push`) is still in `package.json` for throwaway local
> experiments, but it keeps no history and **must never be run against production** — it
> will silently drop a column, and its data, to make the database match the schema. Mixing
> it with migrations also drifts your local DB out of sync with the history. See
> [`docs/DEPLOYMENT.md` §9](docs/DEPLOYMENT.md).
>
> ⚠️ **Restart the API after any schema change.** `db push` regenerates the Prisma client
> (including its query-engine binary) underneath the running server, which makes every
> database route return `500`. `node --watch` cannot auto-restart here because inotify
> doesn't fire on the `/mnt/hgfs` shared mount — stop and restart `npm run dev` yourself.

---

## Environment (`backend/.env`)

| Key | Purpose |
|-----|---------|
| `DATABASE_URL` | MySQL connection string (`mysql://gngrll:...@localhost:3306/gngrll_dev`) |
| `SESSION_SECRET` | Signs the session cookie |
| `PORT` | API port (default 3001) |
| `CLIENT_ORIGIN` | Allowed browser origin (http://localhost:5173) |
| `SEED_DIR` | Path to the `seed/gngrll/` content directory |
| `MAIL_DRIVER` | `console` (default — prints mail to this terminal, sends nothing), `smtp`, or `gmail` |
| `MAIL_FROM` | Envelope/From address, e.g. `"G·NG·R Little League <noreply@ll-manager.org>"` |
| `MAIL_BRAND` | Name used inside message bodies |
| `APP_URL` | Base URL for links inside emails (falls back to `CLIENT_ORIGIN`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Only when `MAIL_DRIVER=smtp` (Amazon SES) |
| `MAIL_SECRET` | Signs unsubscribe links (falls back to `SESSION_SECRET`). Changing it invalidates links in already-sent mail |

Password reset and invite emails are implemented and run on the `console` driver by default,
so **no credentials are needed for local development** — reset links print to the API
terminal. See [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md) to switch on Amazon SES.

---

## Troubleshooting

- **`sh: 1: concurrently: not found`** — run `npm install` once in `app/` (installs the
  workspace-root dev dependency), then `npm run dev`. Or just use the two-terminal method.
- **Every API call returns `500` (including ones that used to work)** — the Prisma client
  was regenerated under the running server. Restart `npm run dev`. Your data is fine.
- **`Table 'gngrll_dev.sessions' doesn't exist`** — the login-session store (owned by
  `express-mysql-session`, not Prisma) was missing; the server recreates it on startup, so
  restart and log in again. It is now declared in `schema.prisma` as `model Session` purely
  so `db push` stops dropping it — **do not** remove that model.
- **API won't start / DB errors** — confirm MySQL is up (`mysqladmin -u gngrll -p ping`)
  and that `backend/.env` `DATABASE_URL` points at `gngrll_dev`.
- **Port already in use** — something is still listening on 3001/5173; stop the old
  process (Ctrl+C in its terminal) before restarting.

---

## The Seed Organization

New organizations are **cloned from a template league**, not from JSON files. That template
is an ordinary `League` row flagged `isSeed = true`, named *Seed Organization*:

- A super admin opens it from the admin console ("Edit the template") and edits it with the
  normal league UI — tasks, email templates, policies, calendar, everything.
- Changes apply to organizations created **afterwards**. Existing organizations hold their
  own copies and are never touched.
- It has no real members, is hidden from "Your leagues", and returns 404 to everyone except
  super admins. Super admins get access to the **seed league only** — not to real leagues.
- `npm --workspace backend run seed` reloads it from `seed/gngrll/` on disk. That is a
  bootstrap/reset for a fresh install; day to day, edit it in the app.

There are deliberately **no `Default*` tables** any more — the seed league replaced them.

---

## Super admin

`nate@stoneumbrella.com` is the platform super admin. The console lives at **/admin**
(an "Admin" link appears in the top bar for super admins only) and can create
organizations + invite their owner, manage the email suppression list, and promote
other super admins.

Every `/api/admin/*` route returns **404** — not 403 — for non-admins, so the admin
surface isn't discoverable by probing. League owners get a narrower version of the
suppression tool under **League settings → Email delivery**: exact-match lookup only,
never a listing, so they can fix one person without harvesting addresses.

---

## Fiscal weeks and dates

The league year runs Oct 1 – Sep 30. `weekOfFY` is stored **0-based** (week 0 = the week
containing Oct 1) and displayed **1-based**. Weeks start **Monday**, so a task is due the
Monday of its week by default; `Task.dueDateOverride` pins it to an exact day instead.

Calendar items work the same way (`CalendarItem.dateOverride`) — a fixture like Opening Day
needs an exact day, not its week's Monday. Click any date pill in the Calendar or a role view
to move the item or pin it.

Dates are derived from the week, not stored — `backend/src/lib/fyweeks.js` is the single
source of truth, mirrored in `frontend/src/api.js` for display. Season rollover shifts any
pinned date to the same weekday of the same week in the new season. Changing an item's week
clears a stale pin, so it can't keep a date that no longer matches.

---

## Notes

- Multi-tenant: all league data is scoped by `leagueId`; new leagues clone the GNGRLL
  seed content and can customize it independently.
- Permissions: everyone edits their own role's tasks/templates/calendar; league-wide
  documents (policies, references, agenda templates) are editable by President, VPs, and
  Secretary by default, configurable by the owner under **Permissions**.
