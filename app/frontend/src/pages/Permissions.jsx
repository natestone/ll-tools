import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api.js'

const CATEGORY_LABELS = {
  policies: 'Policies & Procedures',
  references: 'Reference documents',
  agenda_templates: 'Meeting-agenda templates',
  tasks: 'Tasks', email_templates: 'Email templates', calendar: 'Calendar',
}

export default function Permissions() {
  const { leagueId } = useOutletContext()
  const [data, setData] = useState(null)
  const [saving, setSaving] = useState('')

  const load = () => api.get(`/leagues/${leagueId}/permissions`).then(setData)
  useEffect(() => { load() }, [leagueId])
  if (!data) return <p>Loading…</p>

  async function toggle(category, roleKey) {
    const current = data.grants[category] || []
    const next = current.includes(roleKey) ? current.filter((k) => k !== roleKey) : [...current, roleKey]
    setData({ ...data, grants: { ...data.grants, [category]: next } })
    setSaving(category)
    await api.put(`/leagues/${leagueId}/permissions`, { category, roleKeys: next })
    setSaving('')
  }

  return (
    <div>
      <h1>Permissions</h1>
      <div className="card">
        <h2>Who can edit league-wide documents</h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          Click a role to grant/revoke edit access for each category. The <strong>owner</strong> can always edit everything.
        </p>
        <table className="perm-table">
          <thead>
            <tr><th>Category</th><th>Roles that can edit</th></tr>
          </thead>
          <tbody>
            {data.leagueCategories.map((cat) => (
              <tr key={cat}>
                <td className="perm-cat" data-label="Category" style={{ fontWeight: 600 }}>
                  {CATEGORY_LABELS[cat] || cat}
                  {saving === cat && <span className="muted" style={{ marginLeft: 6 }}>saving…</span>}
                </td>
                <td data-label="Roles that can edit" className="perm-roles">
                  <div className="role-toggles">
                    {data.roles.map((r) => {
                      const on = (data.grants[cat] || []).includes(r.key)
                      return (
                        <span key={r.key} className="badge role-toggle" role="button" tabIndex={0}
                          aria-pressed={on} title={(on ? 'Revoke ' : 'Grant ') + r.name}
                          style={{ cursor: 'pointer', opacity: on ? 1 : 0.4 }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(cat, r.key) } }}
                          onClick={() => toggle(cat, r.key)}>{r.name}</span>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Role-scoped content</h2>
        <p className="muted">
          These are always editable by whoever holds the matching role — everyone manages their <strong>own</strong> role's items.
          Grant cross-role editing above only if you extend it later.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {data.roleScopedCategories.map((c) => <span key={c} className="pill">{CATEGORY_LABELS[c] || c}</span>)}
        </div>
      </div>
    </div>
  )
}
