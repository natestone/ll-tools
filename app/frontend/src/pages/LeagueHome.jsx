import React from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'

/* Landing spot for /l/:leagueId.

   This used to be a hard-coded redirect to "dashboard", which is owner-only — so
   any non-owner opening the league URL was met with a bare "owner only" error.
   Nobody hit it while invites required an existing account; now that officers can
   join from an emailed link, it's the first thing they'd see.

   Send each person somewhere they can actually use: owners to the dashboard,
   officers to their own role, and a member with no role yet to the calendar. */
export default function LeagueHome() {
  const { league } = useOutletContext()
  if (!league) return null
  if (league.isOwner) return <Navigate to="dashboard" replace />
  const role = league.myRoles?.[0]
  return <Navigate to={role ? `role/${role.key}` : 'calendar'} replace />
}
