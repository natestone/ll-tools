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

/* ---- All-Star voting ----------------------------------------------------- */

export function allStarBallotInvite({ voterName, leagueName, year, url, closesAt }) {
  const when = closesAt ? new Date(closesAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) : null
  return {
    subject: `${leagueName} — ${year} All-Star ballot`,
    text: [
      `Hi ${voterName || 'there'},`,
      ``,
      `Your ballot for the ${year} ${leagueName} All-Star selection is ready.`,
      ``,
      `Open your personal ballot:`,
      url,
      ``,
      `This link is yours alone — we'll email you a short code to confirm it's you.`,
      when ? `\nVoting closes ${when}. You can change your rankings until then.` : '',
    ].filter(Boolean).join('\n'),
    html: shell(`${esc(year)} All-Star ballot`, `
      <p>Hi ${esc(voterName || 'there')},</p>
      <p>Your ballot for the ${esc(year)} ${esc(leagueName)} All-Star selection is ready.</p>
      ${button(url, 'Open my ballot')}
      <p style="font-size:13px;color:#6b7280">
        This link is yours alone — we'll email you a short code to confirm it's you.
        ${when ? `<br><strong>Voting closes ${esc(when)}.</strong> You can change your rankings until then.` : ''}
      </p>`),
  }
}

export function allStarVoteCode({ voterName, code, minutes = 20 }) {
  return {
    essential: true,   // they asked for it seconds ago; see ESSENTIAL_NOTE
    subject: `Your voting code: ${code}`,
    text: [
      `Hi ${voterName || 'there'},`, ``,
      `Your All-Star voting code is ${code}`, ``,
      `It expires in ${minutes} minutes. If you didn't ask for it, ignore this email.`,
    ].join('\n'),
    html: shell('Your voting code', `
      <p>Hi ${esc(voterName || 'there')},</p>
      <p style="font-size:30px;font-family:monospace;letter-spacing:6px;margin:18px 0;color:#0b1a3b">
        <strong>${esc(code)}</strong></p>
      <p style="font-size:13px;color:#6b7280">
        Expires in ${minutes} minutes. If you didn't ask for it, ignore this email.</p>`),
  }
}

/* The receipt a parent gets after signing the All-Star consent form. One
   message covers every child on the submission — a family signing up three
   players should not get three near-identical emails.

   Deliberately NOT essential: a parent who has unsubscribed stays unsubscribed,
   and the form's own thank-you page tells them no confirmation could be sent.
   Nothing about the signup depends on this message arriving. */
export function allStarSignupConfirmation({ parentName, leagueName, year, players = [] }) {
  const line = (p) => `${p.playerName} — ${p.levels.join(', ')}`
  const many = players.length > 1
  return {
    subject: `${leagueName} — ${year} All-Star signup confirmed`,
    text: [
      `Hi ${parentName || 'there'},`,
      ``,
      `We've received your ${year} ${leagueName} All-Star signup${many ? 's' : ''}:`,
      ``,
      ...players.map((p) => `  • ${line(p)}`),
      ``,
      `You signed the consent agreement electronically by typing your name on the form.`,
      `Keep this email for your records.`,
      ``,
      `If anything above is wrong, reply to this email and tell the league — don't submit the form again.`,
    ].join('\n'),
    html: shell(`${esc(year)} All-Star signup confirmed`, `
      <p>Hi ${esc(parentName || 'there')},</p>
      <p>We've received your ${esc(year)} ${esc(leagueName)} All-Star signup${many ? 's' : ''}:</p>
      <ul style="padding-left:20px;margin:14px 0">
        ${players.map((p) => `<li style="margin-bottom:6px"><strong>${esc(p.playerName)}</strong><br>
          <span style="color:#6b7280;font-size:13px">${esc(p.levels.join(', '))}</span></li>`).join('')}
      </ul>
      <p>You signed the consent agreement electronically by typing your name on the form.
         Keep this email for your records.</p>
      <p style="font-size:13px;color:#6b7280">
        If anything above is wrong, reply to this email and tell the league —
        please don't submit the form again.
      </p>`),
  }
}

/* ---- changing the sign-in address --------------------------------------- */

/* Sent to the NEW address. Clicking the link is what proves the person
   controls that mailbox, so this is the only message that carries the token. */
export function emailChangeVerify({ displayName, newEmail, token, expiresMinutes = 60 }) {
  const url = `${APP_URL()}/confirm-email?token=${encodeURIComponent(token)}`
  return {
    essential: true,   // user-initiated seconds ago; see ESSENTIAL_NOTE
    subject: `Confirm your new ${BRAND()} email address`,
    text: [
      `Hi ${displayName || 'there'},`,
      ``,
      `You asked to use this address (${newEmail}) to sign in to ${BRAND()}.`,
      `Confirm it by opening this link — it expires in ${expiresMinutes} minutes:`,
      ``,
      url,
      ``,
      `Until you do, keep signing in with your current address.`,
      `If you didn't ask for this, ignore this email and nothing will change.`,
    ].join('\n'),
    html: shell('Confirm your new email address', `
      <p>Hi ${esc(displayName || 'there')},</p>
      <p>You asked to use this address (<strong>${esc(newEmail)}</strong>) to sign in to
         ${esc(BRAND())}.</p>
      ${button(url, 'Confirm this address')}
      <p style="font-size:13px;color:#6b7280">
        This link expires in ${expiresMinutes} minutes. Until you confirm, keep signing in
        with your current address. If you didn't ask for this, ignore this email —
        nothing will change.
      </p>`),
  }
}

/* Sent to the OLD address, both on request and on completion. This is the part
   that makes the flow safe: someone who takes over a session can change the
   address, but they cannot stop the real owner being told it happened. */
export function emailChangeNotice({ displayName, newEmail, done = false }) {
  const what = done
    ? `Your ${BRAND()} sign-in address has been changed to ${newEmail}.`
    : `Someone asked to change your ${BRAND()} sign-in address to ${newEmail}.`
  return {
    essential: true,   // a security notice; see ESSENTIAL_NOTE
    subject: done
      ? `Your ${BRAND()} email address was changed`
      : `Confirm requested: your ${BRAND()} email address`,
    text: [
      `Hi ${displayName || 'there'},`,
      ``,
      what,
      done
        ? `You will sign in with the new address from now on.`
        : `The change only takes effect once that address is confirmed.`,
      ``,
      `If this wasn't you, reset your password immediately and tell your league president.`,
    ].join('\n'),
    html: shell(done ? 'Your email address was changed' : 'A change to your email was requested', `
      <p>Hi ${esc(displayName || 'there')},</p>
      <p>${esc(what)}</p>
      <p style="font-size:13px;color:#6b7280">
        ${done
          ? 'You will sign in with the new address from now on.'
          : 'The change only takes effect once that address is confirmed.'}
        <br><strong>If this wasn't you, reset your password immediately and tell your
        league president.</strong>
      </p>`),
  }
}
