import { readFileSync } from 'node:fs'
import nodemailer from 'nodemailer'
import { isSuppressed, unsubscribeUrl, unsubscribeApiUrl } from './unsubscribe.js'

/* ============================================================================
   The one place the app sends mail.

   Callers only ever do:  await sendMail({ to, subject, text, html })

   Which provider actually delivers it is a single env var, MAIL_DRIVER:
     console  (default) — print to stdout, send nothing. The dev behaviour:
                no credentials needed, and no way to mail a real person by
                accident from a laptop.
     smtp     — any SMTP provider. This is the Amazon SES path (SES exposes an
                SMTP endpoint, so no AWS SDK is required), and equally Postmark,
                Resend, Mailgun or a Workspace relay.
     gmail    — Gmail API via OAuth2, for a Google Workspace mailbox.

   Config is validated once at boot (see verifyMailer) so a missing credential
   is a startup failure, not a surprise during someone's password reset.
   ========================================================================== */

const DRIVER = (process.env.MAIL_DRIVER || 'console').toLowerCase()
const FROM = process.env.MAIL_FROM || 'League Manager <no-reply@localhost>'
const REPLY_TO = process.env.MAIL_REPLY_TO || undefined

class MailConfigError extends Error {}

const need = (key) => {
  const v = process.env[key]
  if (!v) throw new MailConfigError(`MAIL_DRIVER=${DRIVER} requires ${key}`)
  return v
}

/* ---- drivers ------------------------------------------------------------ */

function buildTransport() {
  if (DRIVER === 'console') return null

  if (DRIVER === 'smtp') {
    const port = parseInt(process.env.SMTP_PORT || '587', 10)
    return nodemailer.createTransport({
      host: need('SMTP_HOST'),
      port,
      // 465 is implicit TLS; 587 starts plaintext and upgrades via STARTTLS.
      // requireTLS forces that upgrade so credentials are never sent in clear.
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: need('SMTP_USER'), pass: need('SMTP_PASS') },
    })
  }

  if (DRIVER === 'gmail') {
    const raw = process.env.GOOGLE_SA_KEY_JSON
    const file = process.env.GOOGLE_SA_KEY_FILE
    if (!raw && !file) throw new MailConfigError('MAIL_DRIVER=gmail requires GOOGLE_SA_KEY_JSON or GOOGLE_SA_KEY_FILE')
    let key
    try {
      key = JSON.parse(raw || readFileSync(file, 'utf8'))
    } catch (e) {
      throw new MailConfigError(`could not read the Google service-account key: ${e.message}`)
    }
    const user = need('GMAIL_SENDER')
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user,                             // the impersonated Workspace mailbox
        serviceClient: key.client_id,
        privateKey: key.private_key,
      },
    })
  }

  throw new MailConfigError(`unknown MAIL_DRIVER "${DRIVER}" (expected console, smtp or gmail)`)
}

let transport
try {
  transport = buildTransport()
} catch (e) {
  if (e instanceof MailConfigError) {
    console.error(`\n[mail] ${e.message}\n[mail] Fix backend/.env or set MAIL_DRIVER=console for local dev.\n`)
    process.exit(1)
  }
  throw e
}

/* ---- public API --------------------------------------------------------- */

/**
 * Send one message. Never throws — returns { ok, driver, error? } — because a
 * mail failure must not break the request that triggered it (an invite row is
 * still valid when its notification bounced).
 *
 * Every message gets an unsubscribe footer and List-Unsubscribe headers here
 * rather than in the templates, so a new template physically cannot ship without
 * them. Suppressed addresses are dropped before any send.
 *
 * `essential: true` bypasses the suppression list. Reserved for security mail the
 * user just asked for — see ESSENTIAL_NOTE in emails.js.
 */
export async function sendMail({ to, subject, text, html, replyTo, essential = false }) {
  if (!essential && await isSuppressed(to)) {
    console.log(`[mail] skipped "${subject}" to ${to} — address is unsubscribed`)
    return { ok: false, skipped: true, reason: 'unsubscribed', driver: DRIVER }
  }

  const unsubUrl = unsubscribeUrl(to)
  text = `${text}\n\n—\nDon't want these emails? Unsubscribe:\n${unsubUrl}\n`
  html = `${html}
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:0 24px 24px">
  <p style="font-size:12px;color:#6b7280;margin:0">
    Don't want these emails? <a href="${unsubUrl}" style="color:#6b7280">Unsubscribe</a>.
  </p>
</div>`

  const msg = {
    from: FROM, to, subject, text, html, replyTo: replyTo || REPLY_TO,
    headers: {
      // RFC 8058: gives Gmail/Outlook a native Unsubscribe button and helps
      // deliverability. The mail client POSTs this server-to-server.
      'List-Unsubscribe': `<${unsubscribeApiUrl(to)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }

  if (!transport) {
    const line = '─'.repeat(64)
    console.log(
      `\n${line}\n[mail:console] would send\n  to:      ${to}\n  from:    ${FROM}`
      + `\n  subject: ${subject}\n${line}\n${text}\n${line}\n`,
    )
    return { ok: true, driver: 'console' }
  }

  try {
    const info = await transport.sendMail(msg)
    return { ok: true, driver: DRIVER, id: info.messageId }
  } catch (e) {
    // Log server-side; hand the caller a flag, never an exception.
    console.error(`[mail] send to ${to} failed:`, e.message)
    return { ok: false, driver: DRIVER, error: e.message }
  }
}

/** Called at boot: proves the credentials work before anyone needs them. */
export async function verifyMailer() {
  if (!transport) {
    console.log('[mail] driver=console — emails are printed, not sent')
    return
  }
  try {
    await transport.verify()
    console.log(`[mail] driver=${DRIVER} ready, sending as ${FROM}`)
  } catch (e) {
    // A warning, not a crash: the API should still serve everything else.
    console.warn(`[mail] driver=${DRIVER} could NOT connect: ${e.message}`)
  }
}

export const mailerDriver = DRIVER
