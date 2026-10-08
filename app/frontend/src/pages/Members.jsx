import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '../api.js'
import { EditableText } from '../components/Editable.jsx'

/* Create and manage the league's roles.

   A role's `key` is referenced by tasks, email templates, calendar items and the
   permission matrix with no foreign key behind it, so the key never changes once
   created — renaming only changes the display name. Deleting is likewise only
   offered for custom roles, and only after its content has somewhere to go. */
function RolesCard({ leagueId, roles, onChanged }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add(e) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api.post(`/leagues/${leagueId}/roles`, { name, description: desc })
      setName(''); setDesc(''); await onChanged()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function rename(r, newName) {
    setErr('')
    try { await api.patch(`/leagues/${leagueId}/roles/${r.id}`, { name: newName }); await onChanged() }
    catch (ex) { setErr(ex.message) }
  }
  async function remove(r) {
    setErr('')
    try {
      const { usage } = await api.get(`/leagues/${leagueId}/roles/${r.id}/usage`)
      let qs = ''
      if (usage.total) {
        const others = roles.filter((x) => x.key !== r.key)
        const target = window.prompt(
          `${r.name} still has ${usage.tasks} task(s), ${usage.templates} template(s) and `
          + `${usage.calendar} calendar item(s).\n\nType the key of the role to move them to:\n`
          + others.map((x) => x.key).join(', '))
        if (!target) return
        qs = `?reassignTo=${encodeURIComponent(target.trim())}`
      } else if (!window.confirm(`Delete the role "${r.name}"?`)) return
      await api.del(`/leagues/${leagueId}/roles/${r.id}${qs}`)
      await onChanged()
    } catch (ex) { setErr(ex.message) }
  }

  return (
    <div className="card">
      <h2>Roles</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Add roles specific to your league. Tasks, templates and calendar items can then be
        assigned to them. Built-in roles can be renamed but not removed.
      </p>
      {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}

      {roles.map((r) => (
        <div key={r.id} className="row role-row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>
            <EditableText value={r.name} pencil onSave={(v) => rename(r, v)} />
          </span>
          <code className="muted" style={{ fontSize: '0.72rem' }}>{r.key}</code>
          {r.isCustom
            ? <button type="button" className="icon-btn danger" title="Delete this role" onClick={() => remove(r)}>×</button>
            : <span className="pill">built-in</span>}
        </div>
      ))}

      <form onSubmit={add} className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <input placeholder="New role name" value={name} required
          onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 180px', minWidth: 0 }} />
        <input placeholder="What do they do? (optional)" value={desc}
          onChange={(e) => setDesc(e.target.value)} style={{ flex: '1 1 180px', minWidth: 0 }} />
        <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add role'}</button>
      </form>
    </div>
  )
}

export default function Members() {
  const { leagueId } = useOutletContext()
  const [memberErr, setMemberErr] = useState('')
  const [members, setMembers] = useState([])
  const [roles, setRoles] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [inviteRoles, setInviteRoles] = useState([])
  const [lastLink, setLastLink] = useState('')

  const load = () => Promise.all([
    api.get(`/leagues/${leagueId}/members`).then(setMembers),
    api.get(`/leagues/${leagueId}/roles`).then(setRoles),
    api.get(`/leagues/${leagueId}/invites`).then(setInvites),
  ])
  useEffect(() => { load() }, [leagueId])

  async function assign(membershipId, roleKey, has) {
    if (has) await api.del(`/leagues/${leagueId}/assignments`, { membershipId, roleKey })
    else await api.post(`/leagues/${leagueId}/assignments`, { membershipId, roleKey })
    await load()
  }
  async function saveMember(membershipId, patch) {
    setMemberErr('')
    try {
      const r = await api.patch(`/leagues/${leagueId}/members/${membershipId}`, patch)
      setMembers((ms) => ms.map((m) => (m.membershipId === membershipId ? { ...m, user: r.user } : m)))
    } catch (e) { setMemberErr(e.message || 'Could not save') }
  }
  async function invite(e) {
    e.preventDefault()
    const r = await api.post(`/leagues/${leagueId}/invites`, { email, roleKeys: inviteRoles })
    setLastLink(r.acceptUrl); setEmail(''); setInviteRoles([]); await load()
  }

  return (
    <div>
      <h1>Members & roles</h1>
      <div className="card">
        <h2>Members</h2>
        {memberErr && <p className="err">{memberErr}</p>}
        <table className="members-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Roles (click to toggle)</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId}>
                <td data-label="Name" className="member-name">
                  <EditableText value={m.user.displayName} pencil
                    onSave={(v) => saveMember(m.membershipId, { displayName: v })} />
                  {m.isOwner && <span className="pill" style={{ marginLeft: 6 }}>owner</span>}
                </td>
                <td data-label="Email" className="member-email">
                  <EditableText value={m.user.email} pencil placeholder="Add email…"
                    onSave={(v) => saveMember(m.membershipId, { email: v })} />
                </td>
                <td data-label="Phone" className="member-phone">
                  <EditableText value={m.user.phone || ''} pencil placeholder="Add phone…"
                    onSave={(v) => saveMember(m.membershipId, { phone: v })} />
                </td>
                <td data-label="Roles (click to toggle)" className="member-roles">
                  <div className="role-toggles">
                    {roles.map((r) => {
                      const has = m.roles.some((x) => x.key === r.key)
                      return (
                        <span key={r.key} className="badge role-toggle" role="button" tabIndex={0}
                          aria-pressed={has} title={(has ? 'Remove ' : 'Add ') + r.name}
                          style={{ cursor: 'pointer', opacity: has ? 1 : 0.4 }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); assign(m.membershipId, r.key, has) } }}
                          onClick={() => assign(m.membershipId, r.key, has)}>{r.name}</span>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RolesCard leagueId={leagueId} roles={roles} onChanged={load} />

      <div className="card" style={{ maxWidth: 560 }}>
        <h2>Invite an officer</h2>
        <form onSubmit={invite}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Assign roles</label>
          <div className="role-toggles">
            {roles.map((r) => {
              const on = inviteRoles.includes(r.key)
              const flip = () => setInviteRoles((s) => on ? s.filter((k) => k !== r.key) : [...s, r.key])
              return (
                <span key={r.key} className="badge role-toggle" role="button" tabIndex={0}
                  aria-pressed={on} style={{ cursor: 'pointer', opacity: on ? 1 : 0.4 }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip() } }}
                  onClick={flip}>{r.name}</span>
              )
            })}
          </div>
          <div style={{ marginTop: 12 }}><button>Create invite</button></div>
        </form>
        {lastLink && (<p className="muted" style={{ marginTop: 10 }}>
          Dev invite link (no email server): <br />
          <code className="invite-link" style={{ wordBreak: 'break-all' }}>{lastLink}</code></p>)}
      </div>

      <div className="card">
        <h2>Pending invites</h2>
        {invites.filter((i) => i.status === 'pending').map((i) => (
          <div key={i.id} className="row invite-row" style={{ padding: '4px 0' }}>
            {/* minWidth:0 + overflowWrap let a long address shrink/break instead of
                pushing the flex row (and the page) wider than the screen */}
            <div className="invite-email" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{i.email}</div>
            <div className="invite-roles">{(i.roleKeys || []).join(', ')}</div>
          </div>
        ))}
        {invites.filter((i) => i.status === 'pending').length === 0 && <p className="muted">None.</p>}
      </div>
    </div>
  )
}
