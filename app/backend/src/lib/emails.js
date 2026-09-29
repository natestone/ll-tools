/* ============================================================================
   System email bodies. These are NOT the 64 seeded league templates — those stay
   copy-paste content for a human's mail client. These are the handful of messages
   the server itself sends.

   Every message carries a text/plain part as well as HTML: board members read mail
   on phones with images off, and a missing text part measurably hurts both
   deliverability and spam scoring.
   ========================================================================== */

const APP_URL = () => (process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '')
const BRAND = () => process.env.MAIL_BRAND || 'League Manager'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* A deliberately plain shell — heavy HTML mail is what trips spam filters, and a
   single-column table renders the same in Gmail, Outlook and Apple Mail. */
const shell = (heading, bodyHtml) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1d2433;max-width:560px;margin:0 auto;padding:24px">
  <div style="border-top:4px solid #c41e3a;padding-top:16px">
    <h1 style="font-size:19px;margin:0 0 14px;color:#0b1a3b">${esc(heading)}</h1>
    ${bodyHtml}
    <p style="margin-top:26px;padding-top:14px;border-top:1px solid #e3e7ee;font-size:12px;color:#6b7280">
      ${esc(BRAND())}
    </p>
  </div>
</div>`

const button = (url, label) => `
  <p style="margin:22px 0">
    <a href="${esc(url)}" style="background:#c41e3a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;display:inline-block;font-weight:600">${esc(label)}</a>
  </p>
  <p style="font-size:13px;color:#6b7280;word-break:break-all">
    If the button doesn't work, paste this into your browser:<br>${esc(url)}
  </p>`


/* ---------------------------------------------------------------------------
   ESSENTIAL_NOTE

   `essential: true` makes sendMail bypass the unsubscribe suppression list.

   Only password reset and the password-changed notice carry it. An unsubscribed
   person who then forgets their password would otherwise be permanently locked
   out: the reset mail would be silently dropped and there is no other way back
   in. A reset is also user-initiated — they asked for that exact message seconds
   earlier, which is the strongest consent signal there is.

   Every message still shows the unsubscribe link, including these.

   To make the suppression list absolute instead, delete the `essential: true`
   lines below; nothing else needs to change.
   ------------------------------------------------------------------------- */

/* ---- password reset ----------------------------------------------------- */

export function passwordReset({ displayName, token, expiresMinutes = 60 }) {
  const url = `${APP_URL()}/reset?token=${encodeURIComponent(token)}`
  return {
    essential: true,   // see ESSENTIAL_NOTE
    subject: `Reset your ${BRAND()} password`,
    text: [
      `Hi ${displayName || 'there'},`,
      ``,
      `Someone asked to reset the password for this ${BRAND()} account.`,
      `Open this link to choose a new one — it expires in ${expiresMinutes} minutes and can only be used once:`,
      ``,
      url,
      ``,
      `If you didn't ask for this, you can ignore this email. Your password won't change.`,
    ].join('\n'),
    html: shell('Reset your password', `
      <p>Hi ${esc(displayName || 'there')},</p>
      <p>Someone asked to reset the password for this ${esc(BRAND())} account.</p>
      ${button(url, 'Choose a new password')}
      <p style="font-size:13px;color:#6b7280">
        This link expires in ${expiresMinutes} minutes and can only be used once.
        If you didn't ask for this, you can ignore this email — your password won't change.
      </p>`),
  }
}

/* ---- password changed (security notice, deliberately has no link) -------- */

export function passwordChanged({ displayName }) {
  return {
    essential: true,   // see ESSENTIAL_NOTE
    subject: `Your ${BRAND()} password was changed`,
    text: [
      `Hi ${displayName || 'there'},`,
      ``,
      `Your ${BRAND()} password was just changed and you've been signed out everywhere else.`,
      ``,
      `If this wasn't you, reset your password immediately and tell your league president.`,
    ].join('\n'),
    html: shell('Your password was changed', `
      <p>Hi ${esc(displayName || 'there')},</p>
      <p>Your ${esc(BRAND())} password was just changed, and you've been signed out on every other device.</p>
      <p style="font-size:13px;color:#6b7280">
        If this wasn't you, reset your password immediately and tell your league president.
      </p>`),
  }
}

/* ---- league invite ------------------------------------------------------ */

export function leagueInvite({ leagueName, inviterName, roleNames = [], token, expiresAt }) {
  const url = `${APP_URL()}/invite/accept?token=${encodeURIComponent(token)}`
  const roles = roleNames.length ? roleNames.join(', ') : null
  const when = expiresAt ? new Date(expiresAt).toLocaleDateString() : null
  return {
    subject: `${inviterName || 'Someone'} invited you to ${leagueName}`,
    text: [
      `${inviterName || 'Someone'} invited you to help run ${leagueName} on ${BRAND()}.`,
      roles ? `\nYou'll be set up as: ${roles}` : '',
      ``,
      `Accept the invitation here:`,
      url,
      ``,
      when ? `This invitation expires on ${when}.` : '',
      `You'll be able to sign in or create an account on that page.`,
    ].filter(Boolean).join('\n'),
    html: shell(`You've been invited to ${leagueName}`, `
      <p><strong>${esc(inviterName || 'Someone')}</strong> invited you to help run
         <strong>${esc(leagueName)}</strong> on ${esc(BRAND())}.</p>
      ${roles ? `<p>You'll be set up as: <strong>${esc(roles)}</strong></p>` : ''}
      ${button(url, 'Accept the invitation')}
      <p style="font-size:13px;color:#6b7280">
        ${when ? `This invitation expires on ${esc(when)}. ` : ''}
        You'll be able to sign in or create an account on that page.
      </p>`),
  }
}
