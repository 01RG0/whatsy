import React, { useState, useEffect } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { API_BASE, getAuthHeader } from '../api/inbox'

// ─── Types ────────────────────────────────────────────────────────────────────

type RangeOption = 'today' | 'week' | 'month' | 'custom'

interface MsgTypeStat { type: string; count: number }
interface TrendPoint { day: string; count: number }
interface OverviewData {
  inboundMessages: number
  outboundMessages: number
  newContacts: number
  activeConversations: number
  unassignedConversations: number
  messageTypes: MsgTypeStat[]
  volumeTrend: TrendPoint[]
  prevInboundMessages?: number
  prevOutboundMessages?: number
  prevNewContacts?: number
  prevActiveConversations?: number
}

interface ActiveHour { hour: number; count: number }
interface AgentStat {
  id: string
  name: string
  avatar: string
  messagesSent: number
  conversationsHandled: number
  activeTimeSeconds: number | null
  activeHours: ActiveHour[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatActiveTime(s: number | null): string {
  if (!s || s < 60) return '< 1m'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function trendPct(current: number, prev?: number): number | null {
  if (!prev || prev === 0) return null
  return Math.round(((current - prev) / prev) * 100)
}

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function exportCSV(overview: OverviewData, agents: AgentStat[]) {
  const busiestHour = (hours: ActiveHour[]) => {
    if (!hours || hours.length === 0) return '—'
    const max = hours.reduce((a, b) => (a.count > b.count ? a : b))
    return `${max.hour}:00`
  }

  const lines: string[] = [
    'Agent Name,Messages Sent,Chats Handled,Avg Reply Time,Busiest Hour',
    `Totals,${overview.outboundMessages},${overview.activeConversations},—,—`,
    ...agents.map((a) =>
      `${a.name},${a.messagesSent},${a.conversationsHandled},${formatActiveTime(a.activeTimeSeconds)},${busiestHour(a.activeHours)}`
    ),
  ]
  const csv = lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `analysis-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: React.ReactNode
  icon: React.ReactNode
  iconColor?: string
  trend?: { pct: number; up: boolean } | null
  highlight?: 'amber' | 'red' | 'green' | null
}

function StatCard({ label, value, icon, iconColor = 'text-[#00a884]', trend, highlight }: StatCardProps) {
  const borderClass =
    highlight === 'amber'
      ? 'border-amber-400 dark:border-amber-500'
      : highlight === 'red'
      ? 'border-red-400 dark:border-red-500'
      : highlight === 'green'
      ? 'border-[#00a884]'
      : 'border-gray-200 dark:border-[#222e35]'

  const iconBg =
    highlight === 'amber'
      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
      : highlight === 'red'
      ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
      : highlight === 'green'
      ? 'bg-[#00a884]/10 text-[#00a884]'
      : `bg-[#00a884]/10 ${iconColor}`

  return (
    <div className={`bg-white dark:bg-[#111b21] rounded-xl border ${borderClass} p-4 flex items-center gap-4`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-gray-900 dark:text-[#e9edef]">{value}</div>
        <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-0.5 truncate">{label}</p>
        {trend && (
          <p className={`text-xs font-medium mt-0.5 ${trend.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
            {trend.up ? '↑' : '↓'} {Math.abs(trend.pct)}%
          </p>
        )}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-4 animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-[#2a3942] rounded w-1/2 mb-3" />
      <div className="h-8 bg-gray-200 dark:bg-[#2a3942] rounded w-1/3" />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-16 text-gray-400 dark:text-[#8696a0]">
      <div className="text-5xl mb-4">📊</div>
      <p className="text-lg font-medium">No activity yet for this period</p>
      <p className="text-sm mt-1">Try selecting a different time range</p>
    </div>
  )
}

interface VolumeTrendChartProps { data: TrendPoint[] }

function VolumeTrendChart({ data }: VolumeTrendChartProps) {
  const formatted = data.map((d) => {
    const date = new Date(d.day)
    const dayAbbr = date.toLocaleDateString('en-US', { weekday: 'short' })
    const fullLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    return { ...d, label: dayAbbr, fullLabel }
  })

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={formatted} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8696a0' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#8696a0' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          formatter={(value: unknown) => [`${value as number} messages`, '']}
          labelFormatter={(_label: React.ReactNode, payload) => {
            if (payload && payload[0]) {
              const d = payload[0].payload as { fullLabel: string }
              return d.fullLabel
            }
            return _label
          }}
          contentStyle={{ background: '#111b21', border: '1px solid #222e35', borderRadius: 8, color: '#e9edef', fontSize: 12 }}
          cursor={{ stroke: '#00a884', strokeWidth: 1, strokeDasharray: '4 2' }}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#00a884"
          strokeWidth={2}
          dot={{ r: 3, fill: '#00a884', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#00a884' }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

interface MessageTypeChartProps { data: MsgTypeStat[] }

function MessageTypeChart({ data }: MessageTypeChartProps) {
  const formatted = data.map((d) => ({ ...d, label: toTitleCase(d.type) }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8696a0' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#8696a0' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          formatter={(value: unknown, _name: unknown, props: { payload?: { label?: string } }) => [`${value as number} ${props?.payload?.label ?? ''} messages`, '']}
          contentStyle={{ background: '#111b21', border: '1px solid #222e35', borderRadius: 8, color: '#e9edef', fontSize: 12 }}
          cursor={{ fill: '#00a884', fillOpacity: 0.08 }}
        />
        <Bar dataKey="count" fill="#00a884" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

interface WorkloadChartProps { agents: AgentStat[] }

function WorkloadChart({ agents }: WorkloadChartProps) {
  const data = agents.map((a) => ({ name: a.name, conversations: a.conversationsHandled }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 36)}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#8696a0' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#8696a0' }} axisLine={false} tickLine={false} width={80} />
        <Tooltip
          formatter={(value: unknown) => [`${value as number} chats`, '']}
          contentStyle={{ background: '#111b21', border: '1px solid #222e35', borderRadius: 8, color: '#e9edef', fontSize: 12 }}
          cursor={{ fill: '#8696a0', fillOpacity: 0.08 }}
        />
        <Bar dataKey="conversations" fill="#8696a0" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

interface HourlyChartProps { activeHours: ActiveHour[] }

function HourlyChart({ activeHours }: HourlyChartProps) {
  const filled = Array.from({ length: 24 }, (_, h) => {
    const found = activeHours.find((a) => a.hour === h)
    return { hour: h, count: found ? found.count : 0 }
  })
  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={filled} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 9, fill: '#8696a0' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(h: number) => (h % 2 === 0 ? `${h}` : '')}
        />
        <YAxis hide allowDecimals={false} />
        <Tooltip
          formatter={(value: unknown) => [`${value as number} msgs`, '']}
          labelFormatter={(h: React.ReactNode) => `${h}:00`}
          contentStyle={{ background: '#111b21', border: '1px solid #222e35', borderRadius: 8, color: '#e9edef', fontSize: 11 }}
          cursor={{ fill: '#00a884', fillOpacity: 0.1 }}
        />
        <Bar dataKey="count" fill="#00a884" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function AgentInitials({ name }: { name: string }) {
  const letters = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white text-xs font-bold shrink-0">
      {letters}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const [range, setRange] = useState<RangeOption>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [agents, setAgents] = useState<AgentStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)

  useEffect(() => {
    if (range === 'custom' && (!customFrom || !customTo)) {
      setOverview(null)
      setAgents([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')

    const params = new URLSearchParams({ range })
    if (range === 'custom') {
      params.set('from', customFrom)
      params.set('to', customTo)
    }

    const authHeader = getAuthHeader()

    Promise.all([
      fetch(`${API_BASE}/v1/analytics/overview?${params}`, { headers: authHeader }),
      fetch(`${API_BASE}/v1/analytics/agents?${params}`, { headers: authHeader }),
    ])
      .then(async ([ovRes, agRes]) => {
        if (cancelled) return
        if (ovRes.status === 403 || agRes.status === 403) {
          throw new Error('You need admin access to view analytics.')
        }
        if (!ovRes.ok) throw new Error(`Overview fetch failed [${ovRes.status}]`)
        if (!agRes.ok) throw new Error(`Agents fetch failed [${agRes.status}]`)
        const [ovData, agData] = await Promise.all([ovRes.json(), agRes.json()])
        if (cancelled) return
        setOverview(ovData as OverviewData)
        setAgents(Array.isArray(agData) ? (agData as AgentStat[]) : [])
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analytics')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [range, customFrom, customTo])

  const rangeLabels: Record<RangeOption, string> = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    custom: 'Custom',
  }

  const hasData = overview && (
    overview.inboundMessages > 0 ||
    overview.outboundMessages > 0 ||
    overview.activeConversations > 0
  )

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-[#0b141a] p-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-[#e9edef]">Analysis</h1>

        <div className="flex flex-wrap items-center gap-2">
          {/* Range pills */}
          <div className="flex items-center gap-1.5">
            {(['today', 'week', 'month', 'custom'] as RangeOption[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  range === r
                    ? 'bg-[#00a884] text-white'
                    : 'bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#374151]'
                }`}
              >
                {rangeLabels[r]}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#00a884]"
              />
              <span className="text-gray-400 dark:text-[#8696a0] text-xs">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#00a884]"
              />
            </div>
          )}

          {/* Export button */}
          {overview && (
            <button
              onClick={() => exportCSV(overview, agents)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-600 dark:text-[#8696a0] hover:border-[#00a884] hover:text-[#00a884] rounded-lg text-xs font-medium transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-lg mb-5">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          {error}
          <button onClick={() => setError('')} className="ml-auto opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : overview ? (
          <>
            <StatCard
              label="Messages Received"
              value={overview.inboundMessages.toLocaleString()}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              }
              iconColor="text-blue-500"
              trend={(() => {
                const p = trendPct(overview.inboundMessages, overview.prevInboundMessages)
                return p !== null ? { pct: p, up: p >= 0 } : null
              })()}
            />
            <StatCard
              label="Messages Sent"
              value={overview.outboundMessages.toLocaleString()}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              }
              iconColor="text-emerald-500"
              trend={(() => {
                const p = trendPct(overview.outboundMessages, overview.prevOutboundMessages)
                return p !== null ? { pct: p, up: p >= 0 } : null
              })()}
            />
            <StatCard
              label="New People"
              value={overview.newContacts.toLocaleString()}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                  <line x1="12" y1="1" x2="12" y2="4" />
                  <line x1="10" y1="2" x2="14" y2="2" />
                </svg>
              }
              iconColor="text-purple-500"
              trend={(() => {
                const p = trendPct(overview.newContacts, overview.prevNewContacts)
                return p !== null ? { pct: p, up: p >= 0 } : null
              })()}
            />
            <StatCard
              label="Open Chats"
              value={overview.activeConversations.toLocaleString()}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
              iconColor="text-teal-500"
              trend={(() => {
                const p = trendPct(overview.activeConversations, overview.prevActiveConversations)
                return p !== null ? { pct: p, up: p >= 0 } : null
              })()}
            />
            <StatCard
              label="Unassigned Chats"
              value={overview.unassignedConversations.toLocaleString()}
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              }
              highlight={overview.unassignedConversations > 0 ? 'amber' : null}
            />
          </>
        ) : null}
      </div>

      {/* No data empty state */}
      {!loading && !error && !hasData && <EmptyState />}

      {/* Volume trend chart (hidden for today) */}
      {!loading && overview && range !== 'today' && (overview.volumeTrend?.length ?? 0) > 0 && (
        <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-[#e9edef] mb-4">Message Volume</h2>
          <VolumeTrendChart data={overview.volumeTrend} />
        </div>
      )}

      {/* Two column: message types + team workload */}
      {!loading && overview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Message types */}
          {(overview.messageTypes?.length ?? 0) > 0 && (
            <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-[#e9edef] mb-4">Message Types</h2>
              <MessageTypeChart data={overview.messageTypes} />
            </div>
          )}

          {/* Team workload */}
          {agents.length > 0 && (
            <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-[#e9edef] mb-4">Team Workload</h2>
              <WorkloadChart agents={agents} />
            </div>
          )}
        </div>
      )}

      {/* Team performance table */}
      {!loading && agents.length > 0 && (
        <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-[#222e35]">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-[#e9edef]">Team Performance</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-[#222e35]">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Agent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Msgs Sent</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Chats Handled</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 dark:text-[#8696a0] uppercase tracking-wide">Active Time</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-[#222e35]">
              {agents.map((agent) => {
                const isWhatsAppApp = agent.id === 'whatsapp-app'
                return (
                <React.Fragment key={agent.id}>
                  <tr
                    onClick={() => !isWhatsAppApp && setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
                    className={`transition-colors ${isWhatsAppApp ? 'cursor-default' : 'hover:bg-gray-50 dark:hover:bg-[#182229] cursor-pointer'}`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {isWhatsAppApp ? (
                          <div className="w-8 h-8 rounded-full bg-[#25d366]/10 flex items-center justify-center shrink-0 text-base">📱</div>
                        ) : agent.avatar ? (
                          <img src={agent.avatar} alt={agent.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <AgentInitials name={agent.name} />
                        )}
                        <div>
                          <span className={`font-medium ${isWhatsAppApp ? 'italic text-gray-500 dark:text-[#8696a0]' : 'text-gray-900 dark:text-[#e9edef]'}`}>
                            {agent.name}
                          </span>
                          {isWhatsAppApp && (
                            <p className="text-xs text-gray-400 dark:text-[#8696a0]">Sent from WhatsApp app</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-[#e9edef]">{agent.messagesSent.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-[#8696a0]">{isWhatsAppApp ? '—' : agent.conversationsHandled.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-[#8696a0]">{isWhatsAppApp ? '—' : formatActiveTime(agent.activeTimeSeconds)}</td>
                    <td className="px-4 py-3 text-right">
                      {!isWhatsAppApp && (
                        <button className="text-gray-400 dark:text-[#8696a0] hover:text-[#00a884] transition-colors p-1">
                          <svg
                            className={`w-4 h-4 transition-transform ${expandedAgent === agent.id ? 'rotate-180' : ''}`}
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                  {!isWhatsAppApp && expandedAgent === agent.id && (
                    <tr key={`${agent.id}-hours`} className="bg-gray-50 dark:bg-[#0d1a20]">
                      <td colSpan={5} className="px-5 py-3">
                        <p className="text-xs text-gray-500 dark:text-[#8696a0] mb-2">Hourly activity</p>
                        <HourlyChart activeHours={agent.activeHours ?? []} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
