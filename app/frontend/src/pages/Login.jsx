import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../App.jsx'

export default function Login() {
  const { setUser } = useAuth()
  const nav = useNavigate()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', displayName: '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault(); setErr('')
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const user = await api.post(path, form)
      setUser(user); nav('/')
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="center">
      <div className="card">
        <h1>GNGRLL League Manager</h1>
        <div className="row auth-tabs" style={{ marginBottom: 12 }}>
          <button type="button" className={mode === 'login' ? '' : 'secondary'} onClick={() => setMode('login')}>Log in</button>
          <button type="button" className={mode === 'register' ? '' : 'secondary'} onClick={() => setMode('register')}>Register</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'register' && (<><label>Name</label>
            <input value={form.displayName} onChange={set('displayName')} required /></>)}
          <label>Email</label>
          <input type="email" value={form.email} onChange={set('email')} required />
          <label>Password</label>
          <input type="password" value={form.password} onChange={set('password')} required />
          {err && <p className="err" style={{ overflowWrap: 'anywhere' }}>{err}</p>}
          <div className="row" style={{ marginTop: 14, alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button type="submit">{mode === 'login' ? 'Log in' : 'Create account'}</button>
            {mode === 'login' && <Link to="/forgot" style={{ fontSize: '0.85rem' }}>Forgot password?</Link>}
          </div>
        </form>
      </div>
    </div>
  )
}
