# Transactional email — how it works, and the Amazon SES setup

**Built and working on the `console` driver.** Password reset, the password-changed
notice, and invite emails are all implemented. Nothing is sent yet — `MAIL_DRIVER=console`
prints messages to the API terminal. Switching to real delivery is §3 plus three env vars.

> Amazon SES is the right call over the Gmail API: it sends **as your domain** with no
> mailbox to buy, speaks plain SMTP (so no AWS SDK), costs ~$0.10 per 1,000 messages, and
> has none of Google's OAuth-consent or refresh-token-expiry problems. The Gmail path is
> kept in §6 as an appendix.

---

## 1. The single setting

```ini
MAIL_DRIVER=console                 # console | smtp | gmail
MAIL_FROM="G·NG·R Little League <noreply@ll-manager.org>"
MAIL_BRAND="G·NG·R Little League"   # name used inside the message bodies
MAIL_REPLY_TO=info@gnglittleleague.org   # optional
APP_URL=https://app.ll-manager.org       # base for links inside emails
```

`console` is the dev default: no credentials needed, and no way to email a real board
member by accident from a laptop. Messages print to the API terminal, reset links included
— which is how you test the whole flow locally.

For SES, that becomes:

```ini
MAIL_DRIVER=smtp
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<SES SMTP username>
SMTP_PASS=<SES SMTP password>
```

Credentials are validated **at boot** (`verifyMailer()` in `index.js`), so a bad password
is a startup warning rather than a surprise during someone's password reset.

---

## 2. What's implemented

### `src/lib/mailer.js`
The only place the app sends mail: `await sendMail({ to, subject, text, html, replyTo })`.
Picks its driver once from `MAIL_DRIVER`. **Never throws** — returns `{ ok, driver, error? }`
— because a mail failure must not break the request that triggered it.

Single dependency: `nodemailer`. It builds the MIME message and speaks SMTP, so `smtp` and
`gmail` both come from one small library rather than the very large `googleapis` package.

### `src/lib/emails.js`
`passwordReset`, `passwordChanged`, `leagueInvite`. Every message has a **text/plain part**
as well as HTML — board members read mail on phones with images off, and a missing text
part measurably hurts deliverability. These are *system* mail only; the 64 seeded league
templates remain copy-paste content for a human's mail client.

### Unsubscribe — `GET`/`POST /api/unsubscribe`
Every outgoing message gets an unsubscribe footer and `List-Unsubscribe` headers, added
inside `sendMail` rather than in the templates, so a new template physically cannot ship
without them. Suppressed addresses are dropped before any send.

- **Stateless signed links.** The address travels in the URL with an HMAC of it
  (`?e=<base64url>&t=<hmac>`), keyed on `MAIL_SECRET` (falling back to `SESSION_SECRET`).
  No row is issued up front, links never expire — an unsubscribe link in a two-year-old
  email must still work — and the signature stops anyone unsubscribing a third party by
  editing the address in the URL. Verified with `timingSafeEqual`.
- **The landing page performs the unsubscribe, not the URL fetch.** Corporate link scanners
  (Outlook Safe Links and friends) follow every link in an incoming message; a plain GET
  that opted people out would unsubscribe them before they ever read the email. Scanners
  don't run JavaScript, so doing the write from the React page avoids that. The
  `List-Unsubscribe` header still points at the API for the RFC 8058 one-click POST that
  Gmail and Outlook call server-to-server for their native Unsubscribe button.
- **Suppression is keyed by address, not user id** — invitees are emailed before they have
  an account, and an address must stay suppressed if the account is deleted and recreated.
- `POST /api/unsubscribe/resubscribe` undoes it, and the landing page offers it. One-click
  opt-out with no way back is a support ticket waiting to happen.

> **Security mail is exempt.** `passwordReset` and `passwordChanged` set `essential: true`,
> which bypasses the suppression list. An unsubscribed person who then forgets their
> password would otherwise be permanently locked out — the reset mail silently dropped, with
> no other way in. A reset is also user-initiated: they asked for that exact message seconds
> earlier. Both still *show* the unsubscribe link. To make suppression absolute, delete the
> two `essential: true` lines in `emails.js` (see `ESSENTIAL_NOTE` there); nothing else
> changes.

### Password reset — `POST /api/auth/forgot` · `POST /api/auth/reset`
New `PasswordReset` table. Design decisions worth knowing:

- **`/forgot` always returns the same 200**, whether or not the address is registered.
  Returning "no such user" would make it an account-enumeration oracle — anyone could test
  which league emails have accounts.
- Only the **SHA-256 of the token** is stored, so a database leak can't be replayed.
- 32 random bytes, **60-minute expiry, single use**. Requesting a new link invalidates the
  old one.
- Expired / already-used / forged tokens all return the **same** message on purpose.
- A successful reset **signs the user out everywhere** — a reset is the remedy for a
  compromised account, so any session an attacker holds dies with it.
- **Rate limited** (5 per 15 min on `/forgot`, 10 on `/reset`). Without this the endpoint is
  a free mail cannon aimed at any address someone types.
- Minimum 8 characters, enforced server-side as well as in the UI.

Frontend: `/forgot` and `/reset?token=…`, plus "Forgot password?" on the login form. Both
sit **outside** the authenticated routes — a locked-out user has no session.

### Invite emails
`POST /leagues/:id/invites` now emails the accept link, and still returns `acceptUrl` in the
response with an `emailed: true|false` flag. The invite row is the source of truth; a failed
send never rolls it back, and the owner can always copy the link by hand.

An invited officer no longer needs an account first:

- `GET /api/invites/preview?token=` — **public**, rate limited (30/15min). Shows who invited
  them, the league, and the roles, so they see what they're joining before committing.
  Rate limited because the token is the only secret; unlimited previews are a guessing oracle.
- `POST /api/invites/register` — creates the account, redeems the invite and signs them in,
  all in one step. Email defaults to the invited address but can be changed (public
  registration already exists, so this grants nothing new).
- `POST /api/invites/accept` — unchanged, for someone already signed in.

`/invite/accept` now renders **signed out** — previously it sat inside the authenticated
routes, so an invitee was bounced to `/login` and the token was lost. The page offers
"Create account" or "I already have one", defaulting to sign-in when the address already has
an account. Invalid, expired and already-used tokens each get their own plain-English message.

---

## 3. Amazon SES setup

### 3.1 Verify the domain

1. AWS console → **Amazon SES** → pick a region (e.g. `us-east-1`) and **stay in it** —
   identities and SMTP credentials are per-region.
2. **Identities → Create identity → Domain**, enter `ll-manager.org`.
3. Leave **Easy DKIM** on (RSA 2048). SES gives you **three CNAME records**.
4. Add those three CNAMEs to the domain's DNS. Verification flips to *Verified* within
   minutes to a few hours.

### 3.2 Leave the sandbox — don't skip this

New SES accounts are in **sandbox**: you may only send to addresses you've verified, capped
at 200 messages/day and 1/sec. Password resets to real board members will simply fail.

**Account dashboard → Request production access.** Describe the use case honestly:
transactional only — password resets and league invitations, to people who asked for an
account; no marketing. Typically approved within 24 hours.

### 3.3 Create SMTP credentials

**SES → SMTP settings → Create SMTP credentials.** This makes an IAM user with
`ses:SendRawEmail` and gives you an SMTP username and password.

The SMTP password is **not** your AWS secret key — it's derived, and it is **shown once**.
Download the CSV. If you lose it, delete the credential and make a new one.

Put them in `backend/.env` as in §1. This file is a credential store: keep it out of git
(it already is) and `chmod 600` it on the server.

### 3.4 Point MAIL_FROM at the verified domain

`MAIL_FROM` must be an address **at the verified domain** (`noreply@ll-manager.org`). It
doesn't need to be a real mailbox — SES sends from it regardless. Set `MAIL_REPLY_TO` to an
address a human actually reads, or replies vanish.

### 3.5 Verify

Restart the API and watch the startup line:

```
[mail] driver=smtp ready, sending as G·NG·R Little League <noreply@ll-manager.org>
```

Then use "Forgot password?" with your own address and confirm the mail arrives.

---

## 4. DNS — required for deliverability

| Record | Host | Value |
|---|---|---|
| CNAME ×3 | provided by SES | Easy DKIM — from §3.1 |
| TXT (SPF) | `@` | `v=spf1 include:amazonses.com ~all` |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@ll-manager.org` |

Publish exactly **one** SPF record for the domain — multiple SPF TXT records are a hard
fail. If the domain already has SPF, merge `include:amazonses.com` into the existing record
rather than adding a second one.

Start DMARC at `p=none`, read the reports for a couple of weeks, then tighten to
`quarantine` and eventually `reject`.

DKIM alone satisfies DMARC alignment, so a custom MAIL FROM subdomain is optional. Add one
(SES → the identity → *Custom MAIL FROM domain*, e.g. `mail.ll-manager.org`, needs an MX
plus a TXT) only if you want SPF to align to your domain too.

**Watch bounces.** SES suspends accounts with a high bounce or complaint rate. Invites go to
addresses typed by hand, which is exactly how bounces happen — if you start sending volume,
add an SNS-backed configuration set for bounce notifications.

---

## 5. Testing locally

The console driver prints the whole message, reset link included, so the full flow is
testable with no credentials:

```bash
curl -X POST http://localhost:3001/api/auth/forgot \
  -H 'Content-Type: application/json' -d '{"email":"nate@example.com"}'
# -> the API terminal prints the message; copy the /reset?token=... link into the browser
```

Verified working: identical responses for known and unknown addresses; forged, expired and
replayed tokens all rejected; single-use enforced; sessions revoked on success.

---

## 6. Appendix — Gmail API (not recommended)

Kept because the `gmail` driver exists in `mailer.js`. Only worth it if you already pay for
Google Workspace on the sending domain.

Gmail sends **as a real mailbox**, so `noreply@ll-manager.org` requires a Workspace seat on
that domain — a free `@gmail.com` account cannot send as your domain. Setup: GCP project →
enable Gmail API → service account → JSON key → Workspace Admin → *Security → API controls →
Domain-wide delegation*, authorizing the service account's numeric Client ID for the single
scope `https://www.googleapis.com/auth/gmail.send` (never `mail.google.com`, which grants
read and delete). Then:

```ini
MAIL_DRIVER=gmail
GMAIL_SENDER=noreply@ll-manager.org
GOOGLE_SA_KEY_FILE=/etc/ll-manager/gmail-sa.json
```

Without Workspace the only Gmail route is an OAuth2 refresh token, and while the OAuth app
sits in *Testing* status Google expires refresh tokens after **7 days** — mail silently dies
every week. Escaping that needs production status, and `gmail.send` is a *restricted* scope
subject to verification. This is why SES wins.
