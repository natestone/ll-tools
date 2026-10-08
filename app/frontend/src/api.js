async function req(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).error || msg } catch {}
    const err = new Error(msg); err.status = res.status; throw err
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  patch: (p, b) => req('PATCH', p, b),
  del: (p, b) => req('DELETE', p, b),
}

/* ---- Fiscal-year weeks <-> real dates -------------------------------------
   Mirrors backend/src/lib/fyweeks.js. The league year runs Oct 1 -> Sep 30;
   week 0 is the week containing Oct 1, and weeks start MONDAY. Stored 0-based,
   displayed 1-based — only the label shifts, values never do.

   Dates are built and formatted in UTC: these are calendar days, not instants,
   and local formatting would shift them a day for viewers west of UTC.

   This replaces a hand-written month table that was badly wrong (it gave October
   two weeks and September twelve). Months are now derived from the real date. */
const DAY = 86400000

export function fyWeekZero(seasonYear) {
  const oct1 = new Date(Date.UTC(seasonYear, 9, 1))
  const backToMonday = (oct1.getUTCDay() + 6) % 7   // Mon->0 … Sun->6
  return new Date(oct1.getTime() - backToMonday * DAY)
}

export function weekStartDate(seasonYear, w) {
  if (w == null || seasonYear == null) return null
  return new Date(fyWeekZero(seasonYear).getTime() + Math.max(0, Math.min(51, w)) * 7 * DAY)
}

export const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  : '')

export const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

export const monthOfWeek = (seasonYear, w) => {
  const d = weekStartDate(seasonYear, w)
  return d ? d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : ''
}

/* "wk 3 (Oct 13)". Without a season year there is no real date to show, so it
   degrades to "wk 3" rather than inventing a month. */
export const weekLabel = (w, seasonYear) => {
  if (w == null) return '—'
  const d = weekStartDate(seasonYear, w)
  return d ? `wk ${w + 1} (${fmtDate(d)})` : `wk ${w + 1}`
}

/* ---- Task ordering --------------------------------------------------------
   Sorted by the date the task actually lands on, so a pinned override orders
   where it falls rather than where its week starts. */
export const sortTasks = (list) => [...list].sort((a, b) =>
  (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
  || (a.dueWeekOfFY ?? 99) - (b.dueWeekOfFY ?? 99)
  || String(a.title).localeCompare(String(b.title)))

/* Re-sorting moves the row the user is working in, often off-screen. Scroll it
   back under the cursor, but only when its position actually changed — doing it
   on every edit yanks the page around for no reason. */
export function keepTaskInView(id, prevIndex, nextIndex) {
  if (prevIndex === nextIndex) return
  requestAnimationFrame(() => {
    const el = document.getElementById(`task-${id}`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}
