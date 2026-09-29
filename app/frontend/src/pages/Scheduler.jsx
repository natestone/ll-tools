import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { createWeeklySchedule } from '../scheduler/engine.js'
import { downloadScheduleCsv } from '../scheduler/csv.js'
import DivisionSetup from '../scheduler/DivisionSetup.jsx'
import FieldSetup from '../scheduler/FieldSetup.jsx'
import TeamSetup from '../scheduler/TeamSetup.jsx'
import ScheduleList from '../scheduler/ScheduleList.jsx'
import ScheduleCalendar from '../scheduler/ScheduleCalendar.jsx'
import '../scheduler/scheduler.css'

// Bump this whenever the scheduling logic changes in a way that makes
// previously-saved schedules stale. A saved schedule whose engineVersion
// doesn't match is discarded.
const SCHEDULE_ENGINE_VERSION = 6

// ---------- helpers ----------
const toInputValue = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultConfig() {
  const today = new Date()
  const end = new Date(today)
  end.setDate(end.getDate() + 42) // 6 weeks
  return {
    startDate: toInputValue(today),
    endDate: toInputValue(end),
    divisions: [''],
    fields: [
      { name: '', slots: ['18:00'] },
      { name: '', slots: ['18:00'] },
    ],
    teams: [emptyTeam(), emptyTeam(), emptyTeam()],
  }
}

function emptyTeam() {
  return { name: '', primaryDivision: '', homeField: '', gamesPerWeek: '2', daysOff: [], crossDivisions: [] }
}

// Convert a saved config's daysOff into the exact args the engine expects.
// Field slots 24h -> 12h ("18:00" -> "6:00 PM"); gpw parse int clamp 1..7.
function to12h(hhmm) {
  const [hours, minutes] = hhmm.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minutes} ${ampm}`
}

// Serialize (Date->ISO, Set->Array) before saving the schedule.
function serializeSchedule(scheduleData) {
  if (!scheduleData || !scheduleData.schedule) return null
  const games = scheduleData.schedule.map(g => ({
    ...g,
    date: g.date instanceof Date ? g.date.toISOString() : g.date,
  }))
  const teamStats = {}
  for (const team in scheduleData.teamStats) {
    const s = scheduleData.teamStats[team]
    teamStats[team] = {
      ...s,
      opponents: s.opponents instanceof Set ? Array.from(s.opponents) : (s.opponents || []),
    }
  }
  return { ...scheduleData, schedule: games, teamStats }
}

// Deserialize on load (ISO->Date, Array->Set).
function deserializeSchedule(raw) {
  if (!raw || !raw.schedule) return null
  const games = raw.schedule.map(g => ({ ...g, date: new Date(g.date) }))
  const teamStats = {}
  for (const team in raw.teamStats) {
    const s = raw.teamStats[team]
    teamStats[team] = { ...s, opponents: new Set(s.opponents || []) }
  }
  return {
    ...raw,
    schedule: games,
    teamStats,
    seasonStart: raw.seasonStart ? new Date(raw.seasonStart) : null,
  }
}

// ---------- API ----------
async function schedApi(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error('scheduler api ' + res.status)
  return res.status === 204 ? null : res.json()
}

export default function Scheduler() {
  const { leagueId } = useOutletContext()
  const base = `/api/leagues/${leagueId}/scheduler`

  const [config, setConfig] = useState(defaultConfig)
  const [view, setView] = useState('list')
  const [schedule, setSchedule] = useState(null)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [restoreNotice, setRestoreNotice] = useState('')
  const [loaded, setLoaded] = useState(false)

  const restoringRef = useRef(true)   // suppress autosave while restoring/mounting
  const saveTimer = useRef(null)

  // ----- Load saved state on mount -----
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!leagueId) { setLoaded(true); restoringRef.current = false; return }
      let state
      try {
        state = await schedApi(base, 'GET', '')
      } catch (e) {
        setLoaded(true); restoringRef.current = false; return
      }
      if (cancelled) return

      const form = state && state.preferences && state.preferences.form
      if (form) {
        setConfig(normalizeForm(form))
        if (state.view) setView(state.view)

        const snap = state.schedule // { savedAt, engineVersion, schedule }
        const scheduleIsCurrent = snap && snap.schedule && snap.engineVersion === SCHEDULE_ENGINE_VERSION
        if (scheduleIsCurrent) {
          const revived = deserializeSchedule(snap.schedule)
          if (revived) setSchedule(revived)
          setRestoreNotice(noticeText(snap.savedAt, false))
        } else if (snap && snap.schedule) {
          // Older engine: regenerate from restored settings.
          try {
            const regenerated = runEngine(normalizeForm(form))
            if (regenerated.schedule) setSchedule(regenerated.data)
          } catch (e) { /* ignore */ }
          setRestoreNotice(noticeText(snap.savedAt, true))
        } else {
          setRestoreNotice(noticeText(state.updatedAt, false))
        }
      }
      setLoaded(true)
      // allow autosave after the restore-driven state settles
      setTimeout(() => { restoringRef.current = false }, 0)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  // ----- Debounced preferences autosave on config/view change -----
  useEffect(() => {
    if (!loaded || restoringRef.current || !leagueId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await schedApi(base, 'PUT', '/preferences', {
          preferences: { form: config },
          view,
        })
      } catch (e) {
        console.warn('Could not save preferences:', e)
      }
    }, 400)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, view, loaded, leagueId])

  // ----- Generate -----
  const handleGenerate = useCallback(() => {
    setError('')
    const result = runEngine(config)
    if (result.error) { setError(result.error); return }
    setSchedule(result.data)
    setRestoreNotice('') // a fresh schedule supersedes any restored one
  }, [config])

  const handleSaveSchedule = useCallback(async () => {
    if (!leagueId) { setSaveStatus('Not connected to a league.'); return }
    if (!schedule || !schedule.schedule) { setSaveStatus('Generate a schedule first.'); return }
    try {
      // keep preferences in sync
      await schedApi(base, 'PUT', '/preferences', { preferences: { form: config }, view })
      const payload = {
        savedAt: new Date().toISOString(),
        engineVersion: SCHEDULE_ENGINE_VERSION,
        schedule: serializeSchedule(schedule),
      }
      await schedApi(base, 'PUT', '/schedule', { schedule: payload })
      setSaveStatus('✓ Saved ' + new Date().toLocaleString())
    } catch (e) {
      setSaveStatus('Save failed.')
      console.warn('Could not save schedule:', e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, schedule, config, view])

  const handleStartFresh = useCallback(async () => {
    try { if (leagueId) await schedApi(base, 'DELETE', '') } catch (e) { /* ignore */ }
    restoringRef.current = true
    setConfig(defaultConfig())
    setView('list')
    setSchedule(null)
    setError('')
    setSaveStatus('')
    setRestoreNotice('')
    setTimeout(() => { restoringRef.current = false }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  // Generate enabled when >=2 teams, >=1 field, >=1 division.
  const validTeams = config.teams.filter(t => t.name.trim() !== '')
  const validFields = config.fields.filter(f => f.name.trim() !== '')
  const validDivisions = config.divisions.filter(d => d.trim() !== '')
  const canGenerate = validTeams.length >= 2 && validFields.length >= 1 && validDivisions.length >= 1

  return (
    <div className="sched-root">
      <h1>Baseball League Scheduler</h1>

      {restoreNotice && (
        <div className="sched-restore-notice">
          <span>{restoreNotice}</span>
          <button type="button" className="secondary" onClick={handleStartFresh}>Start Fresh</button>
        </div>
      )}

      <div className="card">
        <h2>League Setup</h2>
        <div className="sched-date-inputs">
          <div>
            <label htmlFor="sched-start">Season Start Date</label>
            <input
              id="sched-start"
              type="date"
              value={config.startDate}
              onChange={(e) => setConfig(c => ({ ...c, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="sched-end">Season End Date</label>
            <input
              id="sched-end"
              type="date"
              value={config.endDate}
              onChange={(e) => setConfig(c => ({ ...c, endDate: e.target.value }))}
            />
          </div>
        </div>

        <DivisionSetup
          divisions={config.divisions}
          onChange={(divisions) => setConfig(c => ({ ...c, divisions }))}
        />
        <FieldSetup
          fields={config.fields}
          onChange={(fields) => setConfig(c => ({ ...c, fields }))}
        />
        <TeamSetup
          teams={config.teams}
          divisions={config.divisions}
          fields={config.fields.map(f => f.name)}
          onChange={(teams) => setConfig(c => ({ ...c, teams }))}
        />
      </div>

      <div className="sched-controls">
        <button type="button" onClick={handleGenerate} disabled={!canGenerate}>Generate Schedule</button>
        <button type="button" onClick={handleGenerate} disabled={!canGenerate} className="secondary">New Schedule</button>
        <button type="button" onClick={handleSaveSchedule} disabled={!schedule}>Save Schedule</button>
        <button type="button" onClick={() => downloadScheduleCsv(schedule)} disabled={!schedule} className="secondary">Download CSV</button>
        {saveStatus && <span className="sched-save-status">{saveStatus}</span>}

        <div className="sched-view-toggle">
          <button
            type="button"
            className={'view-btn' + (view === 'list' ? ' active' : '')}
            onClick={() => setView('list')}
          >List View</button>
          <button
            type="button"
            className={'view-btn' + (view === 'calendar' ? ' active' : '')}
            onClick={() => setView('calendar')}
          >Calendar View</button>
        </div>
      </div>

      {error && <div className="sched-error">{error}</div>}

      {schedule && (
        view === 'calendar'
          ? <ScheduleCalendar scheduleData={schedule} />
          : <ScheduleList scheduleData={schedule} />
      )}
    </div>
  )
}

// Ensure a loaded form has the expected array shapes.
function normalizeForm(form) {
  return {
    startDate: form.startDate || '',
    endDate: form.endDate || '',
    divisions: (form.divisions && form.divisions.length) ? form.divisions.slice() : [''],
    fields: (form.fields && form.fields.length)
      ? form.fields.map(f => ({ name: (f.name || '').trim(), slots: (f.slots && f.slots.length) ? f.slots.slice() : ['18:00'] }))
      : [{ name: '', slots: ['18:00'] }, { name: '', slots: ['18:00'] }],
    teams: (form.teams && form.teams.length)
      ? form.teams.map(t => ({
        name: t.name || '',
        primaryDivision: t.primaryDivision || '',
        homeField: (t.homeField || '').trim(),
        gamesPerWeek: t.gamesPerWeek != null ? String(t.gamesPerWeek) : '2',
        daysOff: t.daysOff || [],
        crossDivisions: t.crossDivisions || [],
      }))
      : [emptyTeam(), emptyTeam(), emptyTeam()],
  }
}

function noticeText(savedAt, regenerated) {
  let when = ''
  try { when = savedAt ? new Date(savedAt).toLocaleString() : '' } catch (e) { /* ignore */ }
  return regenerated
    ? `↻ Restored your saved setup${when ? ' from ' + when : ''}. Your previous schedule was made with an older version, so it was regenerated with the current scheduler.`
    : `↻ Restored your saved setup${when ? ' from ' + when : ''}.`
}

// Validate the config, convert it into engine args exactly as the original DOM
// readers did, and run the engine. Returns { data } or { error }.
function runEngine(config) {
  // Read unique team / field / division names (trimmed, dedup, in order).
  const teams = []
  config.teams.forEach(t => {
    const name = t.name.trim()
    if (name && !teams.includes(name)) teams.push(name)
  })
  const fields = []
  config.fields.forEach(f => {
    const name = f.name.trim()
    if (name && !fields.includes(name)) fields.push(name)
  })
  const divisions = []
  config.divisions.forEach(d => {
    const name = d.trim()
    if (name && !divisions.includes(name)) divisions.push(name)
  })

  // Validation (mirrors generateSchedule ~L1705).
  if (teams.length < 2) return { error: 'Please enter at least 2 teams to generate a schedule.' }
  if (fields.length < 1) return { error: 'Please enter at least 1 field to generate a schedule.' }
  if (divisions.length < 1) return { error: 'Please enter at least 1 division to generate a schedule.' }

  // Duplicate names (compare filled entries against the deduped set).
  const rawTeamNames = config.teams.map(t => t.name.trim()).filter(Boolean)
  if (new Set(rawTeamNames).size !== rawTeamNames.length) {
    return { error: 'Please ensure all team names are unique.' }
  }
  const rawFieldNames = config.fields.map(f => f.name.trim()).filter(Boolean)
  if (new Set(rawFieldNames).size !== rawFieldNames.length) {
    return { error: 'Please ensure all field names are unique.' }
  }

  // Build the by-name lookups from each team's config, keyed by trimmed name.
  const teamDivisions = {}
  const teamHomeFields = {}
  const teamDaysOff = {}
  const teamCrossDivisions = {}
  const teamGamesPerWeek = {}
  config.teams.forEach(t => {
    const name = t.name.trim()
    if (!name) return
    teamDivisions[name] = t.primaryDivision || ''
    teamHomeFields[name] = t.homeField || '' // "" means none
    teamDaysOff[name] = (t.daysOff || []).slice()
    teamCrossDivisions[name] = (t.crossDivisions || []).slice()
    let val = parseInt(t.gamesPerWeek, 10)
    if (isNaN(val) || val < 1) val = 1
    if (val > 7) val = 7
    teamGamesPerWeek[name] = val
  })

  // Every team must have a division.
  const teamsWithoutDivision = teams.filter(team => !teamDivisions[team])
  if (teamsWithoutDivision.length > 0) {
    return { error: `Please assign all teams to divisions. Teams without divisions: ${teamsWithoutDivision.join(', ')}` }
  }

  // Field availability: slots 24h -> 12h.
  const fieldAvailability = {}
  config.fields.forEach(f => {
    const name = f.name.trim()
    if (!name || fieldAvailability[name]) return
    const timeSlots = (f.slots || []).filter(Boolean).map(to12h)
    fieldAvailability[name] = { timeSlots: timeSlots.length ? timeSlots : ['6:00 PM', '7:30 PM'] }
  })

  const startDate = new Date(config.startDate)
  const endDate = new Date(config.endDate)
  if (startDate >= endDate) return { error: 'End date must be after start date.' }

  try {
    const data = createWeeklySchedule(
      teams, startDate, endDate, fieldAvailability, teamHomeFields,
      teamDaysOff, teamDivisions, teamCrossDivisions, teamGamesPerWeek
    )
    return { data, schedule: data.schedule }
  } catch (e) {
    return { error: 'Error generating schedule: ' + e.message }
  }
}
