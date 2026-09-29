import React, { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams, Link, useLocation } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'

export default function LeagueShell() {
  const { leagueId } = useParams()
  const { user, setUser } = useAuth()
  const loc = useLocation()
  const [league, setLeague] = useState(null)
  const [err, setErr] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [seasons, setSeasons] = useState(null)
  const [seasonYear, setSeasonYear] = useState(null)

  const refreshLeague = () => api.get(`/leagues/${leagueId}`).then(setLeague).catch((e) => setErr(e.message))
  const loadSeasons = () => api.get(`/leagues/${leagueId}/seasons`).then((s) => {
    setSeasons(s)
    setSeasonYear((y) => (y == null ? s.activeSeasonYear : y))
  }).catch(() => {})

  useEffect(() => {
    setLeague(null); setSeasonYear(null)
    refreshLeague(); loadSeasons()
  }, [leagueId]) // eslint-disable-line react-hooks/exhaustive-deps

  // close the mobile drawer whenever the route changes
  useEffect(() => { setNavOpen(false) }, [loc.pathname])

  async function logout() { await api.post('/auth/logout'); setUser(null) }

  if (err) return <div className="center card"><p className="err">{err}</p><Link to="/">← Leagues</Link></div>
  if (!league) return <div className="center card">Loading league…</div>

  const item = ({ isActive }) => (isActive ? 'active' : '')
  return (
    <div>
      <div className="topbar">
        <button type="button" className="hamburger" aria-label="Menu" aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}>☰</button>
        <Link to="/" className="brand">GNGRLL</Link>
        <span className="topbar-league">· {league.name}</span>
        <span className="pill hide-sm">{league.isOwner ? 'Owner' : 'Officer'}</span>
        <span className="spacer" />
        {seasons && (
          <select className="season-select" value={seasonYear ?? ''} title="Season"
            onChange={(e) => setSeasonYear(parseInt(e.target.value, 10))}>
            {seasons.seasons.map((s) => (
              <option key={s.seasonYear} value={s.seasonYear}>
                {s.label}{s.seasonYear === seasons.activeSeasonYear ? ' ★' : ''}
              </option>
            ))}
          </select>
        )}
        <span className="hide-sm">{user.displayName}</span>
        <a href="#" onClick={logout}>Log out</a>
      </div>

      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}

      <div className="layout">
        <nav className={'sidebar' + (navOpen ? ' open' : '')}>
          {league.isOwner && <NavLink to="dashboard" className={item}>Dashboard</NavLink>}
          <div className="muted" style={{ margin: '12px 0 4px' }}>My roles</div>
          {league.myRoles.length === 0 && <div className="muted" style={{ padding: '0 10px' }}>none assigned</div>}
          {league.myRoles.map((r) => (
            <NavLink key={r.key} to={`role/${r.key}`} className={item}>{r.name}</NavLink>
          ))}
          <div className="muted" style={{ margin: '12px 0 4px' }}>League</div>
          <NavLink to="calendar" className={item}>Calendar</NavLink>
          <NavLink to="scheduler" className={item}>Scheduler</NavLink>
          <NavLink to="templates" className={item}>Email templates</NavLink>
          <NavLink to="tasks" className={item}>Tasks</NavLink>
          <NavLink to="meetings" className={item}>Board meetings</NavLink>
          <NavLink to="policies" className={item}>Policies & docs</NavLink>
          {league.isOwner && <NavLink to="members" className={item}>Members</NavLink>}
          {league.isOwner && <NavLink to="permissions" className={item}>Permissions</NavLink>}
          {league.isOwner && <NavLink to="settings" className={item}>League settings</NavLink>}
        </nav>
        <div className="content">
          <Outlet context={{ league, leagueId, refreshLeague, seasonYear, setSeasonYear, seasons, reloadSeasons: loadSeasons }} />
        </div>
      </div>
    </div>
  )
}
