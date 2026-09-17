import { useState, useEffect, useCallback } from 'react'
import { getAuthHeader, API_BASE } from '../api/inbox'

interface Agent {
  id: string
  name: string
  email: string
  role: 'admin' | 'agent' | 'viewer'
  avatar?: string
  isOnline: boolean
  lastSeen?: string
  activeConversations: number
  messagesToday: number
  avgResponseTime?: string
}

interface InviteForm {
  name: string
  email: string
  role: 'admin' | 'agent' | 'viewer'
  password: string
}

const ROLE_BADGE: Record<Agent['role'], string> = {
  admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  agent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const ROLE_DESCRIPTIONS: Record<Agent['role'], string> = {
  admin: 'Full access to settings, billing, team, and all conversations',
  agent: 'Can send messages and manage assigned conversations',
  viewer: 'Read-only access to conversations and reports',
}

function timeAgo(iso?: string) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function Initials({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const letters = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const sz = size === 'lg' ? 'w-16 h-16 text-xl' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  return (
    <div className={`${sz} rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold shrink-0`}>
      {letters}
    </div>
  )
}

function StatCard({ icon, label, value, pulse }: { icon: React.ReactNode; label: string; value: string | number; pulse?: boolean }) {
  return (
    <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-[#00a884]/10 flex items-center justify-center text-[#00a884] shrink-0">
        {icon}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-gray-900 dark:text-[#e9edef]">{value}</span>
          {pulse && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
        </div>
        <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-0.5">{label}</p>
      </div>
    </div>
  )
}

export default function TeamPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'' | Agent['role']>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'online' | 'offline'>('')
  const [showInvite, setShowInvite] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [inviteForm, setInviteForm] = useState<InviteForm>({ name: '', email: '', role: 'agent', password: '' })
  const [inviteError, setInviteError] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<Agent | null>(null)
  const [panelRoleChanging, setPanelRoleChanging] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const fetchAgents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/agents`, { headers: getAuthHeader() })
      if (!res.ok) throw new Error(`[${res.status}]`)
      const data = await res.json() as Array<Record<string, unknown>>
      const mapped: Agent[] = (Array.isArray(data) ? data : []).map((a) => ({
        id: String(a.id ?? ''),
        name: String(a.name ?? ''),
        email: String(a.email ?? ''),
        role: (['admin', 'agent', 'viewer'].includes(String(a.role)) ? a.role : 'agent') as Agent['role'],
        avatar: a.avatar ? String(a.avatar) : undefined,
        isOnline: Boolean(a.is_online ?? false),
        lastSeen: a.last_seen ? String(a.last_seen) : a.updated_at ? String(a.updated_at) : undefined,
        activeConversations: Number(a.active_conversations ?? 0),
        messagesToday: Number(a.messages_today ?? 0),
        avgResponseTime: a.avg_response_time ? String(a.avg_response_time) : undefined,
      }))
      setAgents(mapped)
    } catch {
      setError('Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  const filtered = agents.filter(a => {
    if (roleFilter && a.role !== roleFilter) return false
    if (statusFilter === 'online' && !a.isOnline) return false
    if (statusFilter === 'offline' && a.isOnline) return false
    if (search) {
      const q = search.toLowerCase()
      return a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    }
    return true
  })

  const stats = {
    total: agents.length,
    online: agents.filter(a => a.isOnline).length,
    messagesTotal: agents.reduce((s, a) => s + a.messagesToday, 0),
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) {
      setInviteError('Name and email are required')
      return
    }
    if (!inviteForm.password.trim() || inviteForm.password.length < 8) {
      setInviteError('Password must be at least 8 characters')
      return
    }
    setInviteLoading(true)
    setInviteError('')
    try {
      const res = await fetch(`${API_BASE}/v1/agents/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(inviteForm),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Failed to create agent [${res.status}]`)
      setInviteSuccess(true)
      setTimeout(() => { setShowInvite(false); setInviteSuccess(false); setInviteForm({ name: '', email: '', role: 'agent', password: '' }) }, 2000)
      fetchAgents()
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setInviteLoading(false)
    }
  }

  async function changeRole(agentId: string, role: Agent['role']) {
    setPanelRoleChanging(true)
    setSaveSuccess(false)
    try {
      const res = await fetch(`${API_BASE}/v1/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) throw new Error(`[${res.status}]`)
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, role } : a))
      setSelectedAgent(prev => prev?.id === agentId ? { ...prev, role } : prev)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    } catch {
      setError('Failed to update role')
    } finally {
      setPanelRoleChanging(false)
    }
  }

  async function removeAgent(agentId: string) {
    setAgents(prev => prev.filter(a => a.id !== agentId))
    if (selectedAgent?.id === agentId) setSelectedAgent(null)
    setConfirmRemove(null)
    try {
      await fetch(`${API_BASE}/v1/agents/${agentId}`, { method: 'DELETE', headers: getAuthHeader() })
    } catch {
      fetchAgents()
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-[#0b141a] p-6 relative">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-[#e9edef]">Team Management</h1>
          <p className="text-gray-500 dark:text-[#8696a0] text-sm mt-0.5">Manage your agents and team roles</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 bg-[#00a884] hover:bg-[#00967a] text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create Agent
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-lg mb-5">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          {error}
          <button onClick={() => setError('')} className="ml-auto opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Agents"
          value={stats.total}
          icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
        />
        <StatCard
          label="Online Now"
          value={stats.online}
          pulse={stats.online > 0}
          icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>}
        />
        <StatCard
          label="Avg Response Time"
          value="1m 45s"
          icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        />
        <StatCard
          label="Messages Today"
          value={stats.messagesTotal}
          icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-[#8696a0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9 pr-3 py-2 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#00a884] w-60"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(['', 'admin', 'agent', 'viewer'] as const).map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${roleFilter === r ? 'bg-[#00a884] text-white' : 'bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-600 dark:text-[#8696a0] hover:border-[#00a884] hover:text-[#00a884]'}`}>
              {r === '' ? 'All Roles' : r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {(['', 'online', 'offline'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusFilter === s ? 'bg-[#00a884] text-white' : 'bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-600 dark:text-[#8696a0] hover:border-[#00a884] hover:text-[#00a884]'}`}>
              {s === '' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Agents Table */}
      <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-3 text-gray-400 dark:text-[#8696a0] text-sm p-8">
            <svg className="animate-spin w-5 h-5 text-[#00a884]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            Loading agents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#202c33] flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-gray-400 dark:text-[#8696a0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
            </div>
            <p className="text-gray-700 dark:text-[#e9edef] font-medium">No agents found</p>
            <p className="text-gray-400 dark:text-[#8696a0] text-sm mt-1">Try a different filter or invite your first agent</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-[#222e35]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Agent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Active Convs</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Last Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-[#222e35]">
              {filtered.map(agent => (
                <tr
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className="hover:bg-gray-50 dark:hover:bg-[#182229] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        {agent.avatar
                          ? <img src={agent.avatar} alt={agent.name} className="w-10 h-10 rounded-full object-cover" />
                          : <Initials name={agent.name} />
                        }
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#111b21] ${agent.isOnline ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-[#e9edef] leading-tight">{agent.name}</p>
                        <p className="text-xs text-gray-400 dark:text-[#8696a0]">{agent.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${ROLE_BADGE[agent.role]}`}>
                      {agent.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${agent.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span className="text-xs text-gray-500 dark:text-[#8696a0]">{agent.isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-700 dark:text-[#e9edef] font-medium">{agent.activeConversations}</span>
                    <span className="text-gray-400 dark:text-[#8696a0] text-xs ml-1">active</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-[#8696a0] text-xs">{timeAgo(agent.lastSeen)}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedAgent(agent)}
                        className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-[#8696a0] bg-gray-100 dark:bg-[#202c33] hover:bg-gray-200 dark:hover:bg-[#2a3942] rounded-lg transition"
                      >Edit</button>
                      <button
                        onClick={() => setConfirmRemove(agent)}
                        className="px-2.5 py-1 text-xs font-medium text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition"
                      >Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Invite Modal ─────────────────────────────────────── */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-gray-200 dark:border-[#222e35] w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-[#222e35]">
              <h2 className="text-lg font-bold text-gray-900 dark:text-[#e9edef]">Create Agent</h2>
              <button onClick={() => { setShowInvite(false); setInviteSuccess(false) }} className="text-gray-400 hover:text-gray-600 dark:hover:text-[#e9edef] transition">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            {inviteSuccess ? (
              <div className="flex flex-col items-center gap-3 py-12 px-6">
                <div className="w-14 h-14 rounded-full bg-[#00a884]/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-[#00a884]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="text-gray-900 dark:text-[#e9edef] font-semibold">Agent created!</p>
                <p className="text-gray-500 dark:text-[#8696a0] text-sm text-center">{inviteForm.name} can now sign in with {inviteForm.email}</p>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="p-6 space-y-5">
                {inviteError && (
                  <p className="text-red-500 dark:text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{inviteError}</p>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1.5">Name</label>
                  <input
                    type="text"
                    required
                    value={inviteForm.name}
                    onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Jane Smith"
                    className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1.5">Email Address</label>
                  <input
                    type="email"
                    required
                    value={inviteForm.email}
                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="colleague@school.com"
                    className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1.5">Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={inviteForm.password}
                    onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Min. 8 characters"
                    className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-2">Role</label>
                  <div className="space-y-2">
                    {(['admin', 'agent', 'viewer'] as const).map(r => (
                      <label
                        key={r}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${inviteForm.role === r ? 'border-[#00a884] bg-[#00a884]/5' : 'border-gray-200 dark:border-[#374151] hover:border-gray-300 dark:hover:border-[#4a5568]'}`}
                      >
                        <input type="radio" name="role" value={r} checked={inviteForm.role === r} onChange={() => setInviteForm(f => ({ ...f, role: r }))} className="mt-0.5 accent-[#00a884]" />
                        <div>
                          <p className={`text-sm font-semibold capitalize ${inviteForm.role === r ? 'text-[#00a884]' : 'text-gray-900 dark:text-[#e9edef]'}`}>{r}</p>
                          <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-0.5">{ROLE_DESCRIPTIONS[r]}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setShowInvite(false)}
                    className="flex-1 py-2.5 border border-gray-200 dark:border-[#374151] text-gray-700 dark:text-[#8696a0] rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#202c33] transition">
                    Cancel
                  </button>
                  <button type="submit" disabled={inviteLoading}
                    className="flex-1 py-2.5 bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition">
                    {inviteLoading ? 'Creating…' : 'Create Agent'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Confirm Remove Modal ──────────────────────────────── */}
      {confirmRemove && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-gray-200 dark:border-[#222e35] w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-[#e9edef]">Remove {confirmRemove.name}?</p>
                <p className="text-xs text-gray-500 dark:text-[#8696a0]">This will remove their access permanently.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmRemove(null)}
                className="flex-1 py-2 border border-gray-200 dark:border-[#374151] text-gray-700 dark:text-[#8696a0] rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-[#202c33] transition">
                Cancel
              </button>
              <button onClick={() => removeAgent(confirmRemove.id)}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Agent Detail Slide-over ───────────────────────────── */}
      {selectedAgent && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSelectedAgent(null)} />
          <div className="fixed right-0 top-0 h-full w-80 bg-white dark:bg-[#111b21] border-l border-gray-200 dark:border-[#222e35] shadow-2xl z-50 overflow-y-auto flex flex-col">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#222e35] shrink-0">
              <span className="font-semibold text-gray-900 dark:text-[#e9edef] text-sm">Agent Profile</span>
              <button onClick={() => setSelectedAgent(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-[#e9edef] transition">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="p-5 flex-1 space-y-5">
              {/* Avatar + name */}
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="relative">
                  {selectedAgent.avatar
                    ? <img src={selectedAgent.avatar} alt={selectedAgent.name} className="w-16 h-16 rounded-full object-cover" />
                    : <Initials name={selectedAgent.name} size="lg" />
                  }
                  <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-[#111b21] ${selectedAgent.isOnline ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-gray-900 dark:text-[#e9edef]">{selectedAgent.name}</p>
                  <p className="text-xs text-gray-400 dark:text-[#8696a0]">{selectedAgent.email}</p>
                  <p className="text-xs text-gray-400 dark:text-[#8696a0] mt-0.5">{selectedAgent.isOnline ? '🟢 Online' : '⚫ Offline'}</p>
                </div>
              </div>

              {/* Role change */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide mb-2">Role</label>
                <select
                  value={selectedAgent.role}
                  disabled={panelRoleChanging}
                  onChange={e => changeRole(selectedAgent.id, e.target.value as Agent['role'])}
                  className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#00a884]"
                >
                  <option value="admin">Admin</option>
                  <option value="agent">Agent</option>
                  <option value="viewer">Viewer</option>
                </select>
                <p className="text-xs text-gray-400 dark:text-[#8696a0] mt-1">{ROLE_DESCRIPTIONS[selectedAgent.role]}</p>
                {saveSuccess && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    Role saved
                  </div>
                )}
                {panelRoleChanging && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400 dark:text-[#8696a0]">
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                    Saving…
                  </div>
                )}
              </div>

              {/* Stats */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide mb-2">Performance</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Active Convs', value: selectedAgent.activeConversations },
                    { label: 'Msgs Today', value: selectedAgent.messagesToday },
                    { label: 'Avg Response', value: selectedAgent.avgResponseTime ?? '—' },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 dark:bg-[#202c33] rounded-lg p-2.5 text-center">
                      <p className="text-base font-bold text-gray-900 dark:text-[#e9edef]">{s.value}</p>
                      <p className="text-[10px] text-gray-400 dark:text-[#8696a0] mt-0.5 leading-tight">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Conversations */}
              <div className="bg-gray-50 dark:bg-[#202c33] rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-[#8696a0]">{selectedAgent.activeConversations} active conversation{selectedAgent.activeConversations !== 1 ? 's' : ''}</span>
                  <button
                    onClick={() => window.dispatchEvent(new PopStateEvent('popstate'))}
                    className="text-xs text-[#00a884] hover:underline"
                  >
                    View in Inbox →
                  </button>
                </div>
              </div>

              {/* Last active */}
              <div className="text-xs text-gray-400 dark:text-[#8696a0]">
                Last active: <span className="text-gray-600 dark:text-[#e9edef]">{timeAgo(selectedAgent.lastSeen)}</span>
              </div>
            </div>

            {/* Danger zone */}
            <div className="px-5 py-4 border-t border-gray-100 dark:border-[#222e35] space-y-2 shrink-0">
              <button className="w-full py-2 text-sm font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition">
                Suspend Agent
              </button>
              <button
                onClick={() => { setConfirmRemove(selectedAgent); setSelectedAgent(null) }}
                className="w-full py-2 text-sm font-medium text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition"
              >
                Remove Agent
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
