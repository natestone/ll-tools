import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/* Date and date-time fields.

   These replace <input type="date"> and <input type="datetime-local">. The
   native Chromium picker hides month and year behind a drill-down whose only
   way back is a caret most people never find — you click "October 2025",
   land in a month/year list, and the calendar is gone.

   Here the month and year are plain selects that are always on screen, so
   there is no mode to get stuck in. The text box still accepts typing, which
   is the fast path for a date of birth nobody wants to reach by paging back
   through fifteen years of calendar.

   Values are plain calendar strings in and out — "YYYY-MM-DD", or
   "YYYY-MM-DDTHH:mm" for the date-time variant — matching what the native
   inputs produced, so call sites did not have to change shape. Nothing here
   constructs a local Date from a value string: these are calendar days, and
   parsing them as instants shifts them a day for anyone west of UTC. */

const pad = (n) => String(n).padStart(2, '0')
const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const firstWeekday = (y, m) => new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const splitISO = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''))
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}

/* Accepts what people actually type: 3/4/26, 03/04/2026, 2026-03-04.
   A 2-digit year lands in this century — nobody is typing 1926 here. */
function parseTyped(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (!m) {
    const s = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(t)
    if (s) {
      const yr = s[3].length === 2 ? 2000 + +s[3] : +s[3]
      m = [null, yr, s[1], s[2]]
    }
  }
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12 || y < 1900 || y > 2200) return null
  if (d < 1 || d > daysInMonth(y, mo)) return null
  return toISO(y, mo, d)
}

const display = (iso) => {
  const p = splitISO(iso)
  return p ? `${pad(p.m)}/${pad(p.d)}/${p.y}` : ''
}

const todayISO = () => {
  const n = new Date()
  return toISO(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

/* ---- the popover ------------------------------------------------------- */

function Calendar({ anchor, value, onPick, onClose, minYear, maxYear }) {
  const start = splitISO(value) || splitISO(todayISO())
  const [view, setView] = useState({ y: start.y, m: start.m })
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  // Fixed positioning, in a portal: these fields sit inside horizontally
  // scrolling tables, which would otherwise clip the popover.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const h = ref.current?.offsetHeight || 320
      const w = ref.current?.offsetWidth || 290
      const below = window.innerHeight - r.bottom
      setPos({
        top: below < h + 8 && r.top > h + 8 ? r.top - h - 6 : r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  useEffect(() => {
    const away = (e) => {
      if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) onClose()
    }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])

  const step = (delta) => setView((v) => {
    const n = v.m + delta
    return n < 1 ? { y: v.y - 1, m: 12 } : n > 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: n }
  })

  const years = []
  for (let y = minYear; y <= maxYear; y++) years.push(y)

  // A full 6-week grid including the neighbouring months' spill, so the popover
  // never changes height as you page through.
  const lead = firstWeekday(view.y, view.m)
  const cells = []
  const prevDays = daysInMonth(view.y, view.m === 1 ? 12 : view.m - 1)
  for (let i = lead - 1; i >= 0; i--) {
    const pm = view.m === 1 ? { y: view.y - 1, m: 12 } : { y: view.y, m: view.m - 1 }
    cells.push({ iso: toISO(pm.y, pm.m, prevDays - i), d: prevDays - i, out: true })
  }
  for (let d = 1; d <= daysInMonth(view.y, view.m); d++) {
    cells.push({ iso: toISO(view.y, view.m, d), d, out: false })
  }
  let n = 1
  while (cells.length < 42) {
    const nm = view.m === 12 ? { y: view.y + 1, m: 1 } : { y: view.y, m: view.m + 1 }
    cells.push({ iso: toISO(nm.y, nm.m, n), d: n, out: true }); n++
  }

  const today = todayISO()

  return createPortal(
    <div className="dp-pop" ref={ref} style={pos ? { top: pos.top, left: pos.left } : { opacity: 0 }}
      role="dialog" aria-label="Choose a date">
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <select value={view.m} aria-label="Month"
          onChange={(e) => setView((v) => ({ ...v, m: +e.target.value }))}>
          {MONTHS.map((nm, i) => <option key={nm} value={i + 1}>{nm}</option>)}
        </select>
        <select value={Math.min(Math.max(view.y, minYear), maxYear)} aria-label="Year"
          onChange={(e) => setView((v) => ({ ...v, y: +e.target.value }))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" className="dp-nav" onClick={() => step(1)} aria-label="Next month">›</button>
      </div>

      <div className="dp-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="dp-grid">
        {cells.map((c) => (
          <button type="button" key={c.iso}
            className={'dp-day'
              + (c.out ? ' out' : '')
              + (c.iso === value ? ' sel' : '')
              + (c.iso === today ? ' today' : '')}
            onClick={() => onPick(c.iso)}>{c.d}</button>
        ))}
      </div>

      <div className="dp-foot">
        <button type="button" className="dp-link" onClick={() => onPick(today)}>Today</button>
        <button type="button" className="dp-link" onClick={() => onPick('')}>Clear</button>
      </div>
    </div>, document.body)
}

/* ---- date ------------------------------------------------------------- */

export function DateField({
  value, onChange, disabled, required, className = '', style, placeholder = 'mm/dd/yyyy',
  minYear, maxYear, title, id,
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(display(value))
  const wrap = useRef(null)
  const nowY = new Date().getFullYear()
  const lo = minYear ?? nowY - 25
  const hi = maxYear ?? nowY + 10

  // Follow the value when it changes elsewhere, but never fight the user
  // mid-keystroke.
  useEffect(() => { setText(display(value)) }, [value])

  const commit = () => {
    const parsed = parseTyped(text)
    if (parsed === null) { setText(display(value)); return }   // unparseable: put it back
    if (parsed !== value) onChange(parsed)
    setText(display(parsed))
  }

  return (
    <span className={`dp-wrap ${className}`} ref={wrap} style={style}>
      <input id={id} type="text" inputMode="numeric" value={text} title={title}
        disabled={disabled} required={required} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
      <button type="button" className="dp-open" disabled={disabled} tabIndex={-1}
        title="Open the calendar" aria-label="Open the calendar"
        onClick={() => setOpen((o) => !o)}>▦</button>
      {open && !disabled && (
        <Calendar anchor={wrap.current} value={splitISO(value) ? value : ''} minYear={lo} maxYear={hi}
          onClose={() => setOpen(false)}
          onPick={(iso) => { onChange(iso); setText(display(iso)); setOpen(false) }} />
      )}
    </span>
  )
}

/* ---- date + time ------------------------------------------------------ */

export function DateTimeField({ value, onChange, disabled, className = '', style, minYear, maxYear, id }) {
  const [datePart, timePart] = String(value || '').split('T')
  const setDate = (d) => onChange(d ? `${d}T${timePart || '18:00'}` : '')
  const setTime = (t) => (datePart ? onChange(`${datePart}T${t || '00:00'}`) : null)

  return (
    <span className={`dp-dt ${className}`} style={style}>
      <DateField id={id} value={datePart || ''} onChange={setDate} disabled={disabled}
        minYear={minYear} maxYear={maxYear} />
      {/* A native time input is a plain spinner with no drill-down, so it has
          none of the problem this component exists to solve. */}
      <input type="time" className="dp-time" value={timePart || ''} disabled={disabled || !datePart}
        title={datePart ? 'Time' : 'Pick a date first'}
        onChange={(e) => setTime(e.target.value)} />
    </span>
  )
}
