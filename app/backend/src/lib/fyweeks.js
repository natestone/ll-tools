/* ============================================================================
   Fiscal-year weeks <-> real calendar dates.

   The league year runs Oct 1 -> Sep 30. Week 0 is the week containing Oct 1, and
   a week starts on MONDAY — so week 0 usually begins in late September. Weeks are
   stored 0-based and displayed 1-based; only the label shifts.

   Dates are built at UTC midnight and treated as date-only. Using local midnight
   would shift a task's due date by a day for anyone east or west of the server,
   and these are calendar days, not instants.
   ========================================================================== */

const DAY = 86400000

/** Season year = the calendar year the fiscal year began (Oct 1).
    e.g. 2026-09-28 is still FY 2025-26 -> season 2025 ("2025–26"). */
export function currentSeasonYear(d = new Date()) {
  return d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1
}

const utc = (y, m, d) => new Date(Date.UTC(y, m, d))

/** Monday of the week containing Oct 1 of `seasonYear`. */
export function fyWeekZero(seasonYear) {
  const oct1 = utc(seasonYear, 9, 1)
  const dow = oct1.getUTCDay()             // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7       // Mon->0, Tue->1, … Sun->6
  return new Date(oct1.getTime() - backToMonday * DAY)
}

/** Start (Monday) of a given fiscal week. */
export function weekStartDate(seasonYear, weekOfFY) {
  if (weekOfFY == null || Number.isNaN(Number(weekOfFY))) return null
  const w = Math.max(0, Math.min(51, Number(weekOfFY)))
  return new Date(fyWeekZero(seasonYear).getTime() + w * 7 * DAY)
}

/** Which fiscal week a date falls in (clamped to 0..51). */
export function weekOfDate(date, seasonYear) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  const base = fyWeekZero(seasonYear)
  const days = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - base.getTime()) / DAY)
  return Math.max(0, Math.min(51, Math.floor(days / 7)))
}

/**
 * The date a task/calendar item actually lands on: the per-item override when
 * set, otherwise the start of its week. This is the single definition of "when",
 * and the one an calendar feed must use.
 */
export function effectiveDate({ weekOfFY, dueWeekOfFY, dueDateOverride }, seasonYear) {
  if (dueDateOverride) {
    const d = new Date(dueDateOverride)
    if (!Number.isNaN(d.getTime())) return d
  }
  return weekStartDate(seasonYear, weekOfFY ?? dueWeekOfFY)
}

/** YYYY-MM-DD, for JSON and <input type="date">. */
export const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

/**
 * Carry a per-task override across a season rollover: keep it the same number of
 * days from its week's start, so "the Thursday of week 12" stays the Thursday of
 * week 12 next year instead of silently drifting to an unrelated weekday.
 */
export function shiftOverrideToSeason(override, weekOfFY, fromYear, toYear) {
  if (!override) return null
  const from = weekStartDate(fromYear, weekOfFY)
  const to = weekStartDate(toYear, weekOfFY)
  if (!from || !to) return null
  const offset = new Date(override).getTime() - from.getTime()
  return new Date(to.getTime() + offset)
}

/* ============================================================================
   Recurring series.

   "Bi-weekly" here means the 1st & 3rd (or 2nd & 4th) occurrence of the weekday
   in its month — the way boards actually schedule — not every-14-days, which
   drifts against the calendar. Monthly keeps the anchor's ordinal, so "the 3rd
   Monday" stays the 3rd Monday.
   ========================================================================== */
export const FREQUENCIES = ['weekly', 'biweekly_1_3', 'biweekly_2_4', 'monthly']

export const FREQUENCY_LABELS = {
  weekly: 'Every week',
  biweekly_1_3: '1st & 3rd week of the month',
  biweekly_2_4: '2nd & 4th week of the month',
  monthly: 'Monthly',
}

/** Which occurrence of its weekday within the month a date is (1st Monday -> 1). */
export function ordinalInMonth(date) {
  return Math.floor((new Date(date).getUTCDate() - 1) / 7) + 1
}

/**
 * The fiscal weeks a series occupies, from `anchorWeek` to the end of the season.
 * Returns 0-based week numbers, always including the anchor itself.
 */
export function seriesWeeks(seasonYear, anchorWeek, frequency) {
  const anchor = Math.max(0, Math.min(51, Number(anchorWeek) || 0))
  const anchorOrd = ordinalInMonth(weekStartDate(seasonYear, anchor))
  const out = []
  for (let w = anchor; w <= 51; w++) {
    const d = weekStartDate(seasonYear, w)
    const ord = ordinalInMonth(d)
    let hit = false
    if (frequency === 'weekly') hit = true
    else if (frequency === 'biweekly_1_3') hit = ord === 1 || ord === 3
    else if (frequency === 'biweekly_2_4') hit = ord === 2 || ord === 4
    else if (frequency === 'monthly') hit = ord === anchorOrd
    if (hit) out.push(w)
  }
  // the anchor always belongs to its own series even if the rule skips that week
  if (!out.includes(anchor)) out.unshift(anchor)
  return out
}

/* ============================================================================
   Playing seasons within the fiscal year.

   GNGRLL runs three: fall ball, spring, and summer (All-Stars / tournaments).
   The months between are administration — registration, budget, elections —
   which belongs to no single season, so those tasks carry a null phase.

   Keyed to the WEEK INDEX, not the month: the fiscal year opens in late
   September and closes in September, so a month-based rule labels week 1 as
   summer when it is really the start of fall ball.
   ========================================================================== */
export const PHASES = ['fall', 'spring', 'summer']
export const PHASE_LABELS = { fall: 'Fall ball', spring: 'Spring', summer: 'Summer' }

// wk1-10 Sep-Nov | wk11-27 Dec-Mar (admin) | wk28-40 Apr-Jun | wk41-52 Jul-Sep
const PHASE_RANGES = [
  ['fall', 0, 9],
  [null, 10, 26],
  ['spring', 27, 39],
  ['summer', 40, 51],
]

/** The phase a fiscal week falls in, or null for the offseason/admin months. */
export function phaseOfWeek(weekOfFY) {
  if (weekOfFY == null) return null
  const w = Math.max(0, Math.min(51, Number(weekOfFY)))
  for (const [phase, lo, hi] of PHASE_RANGES) if (w >= lo && w <= hi) return phase
  return null
}

/** First week of a phase, used when copying a task into another season. */
export function phaseStartWeek(phase) {
  const r = PHASE_RANGES.find(([p]) => p === phase)
  return r ? r[1] : 0
}
