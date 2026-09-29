import React, { createContext, useContext, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import Login from './pages/Login.jsx'
import Leagues from './pages/Leagues.jsx'
import LeagueShell from './pages/LeagueShell.jsx'
import OwnerDashboard from './pages/OwnerDashboard.jsx'
import RoleView from './pages/RoleView.jsx'
import CalendarView from './pages/CalendarView.jsx'
import Templates from './pages/Templates.jsx'
import Tasks from './pages/Tasks.jsx'
import Policies from './pages/Policies.jsx'
import Scheduler from './pages/Scheduler.jsx'
import Permissions from './pages/Permissions.jsx'
import Meetings from './pages/Meetings.jsx'
import LeagueSettings from './pages/LeagueSettings.jsx'
import Members from './pages/Members.jsx'
import InviteAccept from './pages/InviteAccept.jsx'
import LeagueHome from './pages/LeagueHome.jsx'
import Unsubscribe from './pages/Unsubscribe.jsx'
import SuperAdmin from './pages/SuperAdmin.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import ResetPassword from './pages/ResetPassword.jsx'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = loading, null = anon
  useEffect(() => { api.get('/auth/me').then(setUser).catch(() => setUser(null)) }, [])

  const value = { user, setUser }
  if (user === undefined) return <div className="center card">Loading…</div>

  return (
    <AuthCtx.Provider value={value}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* reachable signed-out: a locked-out user has no session */}
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
        {/* an invited officer usually has no account yet — must render signed out */}
        <Route path="/invite/accept" element={<InviteAccept />} />
        {/* public: reachable by anyone holding a link from an email footer */}
        <Route path="/unsubscribe" element={<Unsubscribe />} />
        {!user ? (
          <Route path="*" element={<Navigate to="/login" replace />} />
        ) : (
          <>
            <Route path="/" element={<Leagues />} />
            <Route path="/admin" element={<SuperAdmin />} />
            <Route path="/l/:leagueId" element={<LeagueShell />}>
              <Route index element={<LeagueHome />} />
              <Route path="dashboard" element={<OwnerDashboard />} />
              <Route path="role/:roleKey" element={<RoleView />} />
              <Route path="calendar" element={<CalendarView />} />
              <Route path="templates" element={<Templates />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="policies" element={<Policies />} />
              <Route path="scheduler" element={<Scheduler />} />
              <Route path="meetings" element={<Meetings />} />
              <Route path="members" element={<Members />} />
              <Route path="permissions" element={<Permissions />} />
              <Route path="settings" element={<LeagueSettings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </AuthCtx.Provider>
  )
}
