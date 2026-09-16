import { useState, useEffect } from 'react'
import { getAuthHeader } from '../api/inbox'

interface Rule {
  id: string
  trigger: string
  trigger_type: string
  response: string
  is_active: boolean
  priority: number
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-[#00a884]' : 'bg-[#374151]'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export default function AutoReplyPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [trigger, setTrigger] = useState('')
  const [response, setResponse] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  async function fetchRules() {
    setLoading(true)
    try {
      const res = await fetch('/v1/auto-reply-rules', { headers: getAuthHeader() })
      const data = await res.json()
      setRules(Array.isArray(data) ? data : [])
    } catch {
      setError('Failed to load rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRules() }, [])

  async function toggleRule(id: string, current: boolean) {
    setRules(r => r.map(rule => rule.id === id ? { ...rule, is_active: !current } : rule))
    try {
      await fetch(`/v1/auto-reply-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ is_active: !current }),
      })
    } catch {
      setRules(r => r.map(rule => rule.id === id ? { ...rule, is_active: current } : rule))
      setError('Failed to update rule')
    }
  }

  async function deleteRule(id: string) {
    setRules(r => r.filter(rule => rule.id !== id))
    try {
      await fetch(`/v1/auto-reply-rules/${id}`, { method: 'DELETE', headers: getAuthHeader() })
    } catch {
      setError('Failed to delete rule')
      fetchRules()
    }
  }

  async function addRule() {
    if (!trigger.trim() || !response.trim()) { setError('Trigger and response are required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/v1/auto-reply-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ trigger: trigger.trim(), response: response.trim(), priority: rules.length + 1 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setRules(r => [...r, data])
      setTrigger('')
      setResponse('')
      setShowForm(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-[#0b141a] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-gray-900 dark:text-[#e9edef] text-2xl font-semibold">Auto-Reply Rules</h1>
          <p className="text-gray-500 dark:text-[#8696a0] text-sm mt-0.5">Automatically respond when a trigger keyword is detected</p>
        </div>
        <button
          onClick={() => { setShowForm(f => !f); setError('') }}
          className="flex items-center gap-2 bg-[#00a884] hover:bg-[#00967a] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Rule
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-lg mb-4">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400/60 hover:text-red-400">✕</button>
        </div>
      )}

      {/* Add Rule Form */}
      {showForm && (
        <div className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-xl p-5 mb-6">
          <h2 className="text-gray-900 dark:text-[#e9edef] font-semibold mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00a884]" />
            New Auto-Reply Rule
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[#8696a0] text-xs font-medium mb-1.5 uppercase tracking-wide">Trigger keyword</label>
              <input
                value={trigger}
                onChange={e => setTrigger(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addRule()}
                placeholder="/deadline"
                className="w-full bg-gray-100 dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884] placeholder-gray-400 dark:placeholder-[#8696a0] font-mono border border-gray-200 dark:border-transparent focus:border-[#00a884]/30"
              />
              <p className="text-[#8696a0] text-xs mt-1">Starts with / for commands or any keyword</p>
            </div>
            <div>
              <label className="block text-[#8696a0] text-xs font-medium mb-1.5 uppercase tracking-wide">Auto-reply message</label>
              <textarea
                value={response}
                onChange={e => setResponse(e.target.value)}
                rows={3}
                placeholder="Message sent when trigger matches…"
                className="w-full bg-gray-100 dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884] placeholder-gray-400 dark:placeholder-[#8696a0] resize-none border border-gray-200 dark:border-transparent focus:border-[#00a884]/30"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={addRule}
              disabled={saving}
              className="bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
            >
              {saving ? 'Saving…' : 'Save Rule'}
            </button>
            <button
              onClick={() => { setShowForm(false); setTrigger(''); setResponse(''); setError('') }}
              className="text-[#8696a0] hover:text-[#e9edef] text-sm px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rules List */}
      {loading ? (
        <div className="flex items-center gap-3 text-[#8696a0] text-sm p-8">
          <svg className="animate-spin w-5 h-5 text-[#00a884]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading rules…
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-[#202c33] flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-[#8696a0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-[#e9edef] font-medium">No rules yet</p>
          <p className="text-[#8696a0] text-sm mt-1">Click "New Rule" to add your first auto-reply</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_2fr_auto_auto] gap-4 px-4 py-2">
            <span className="text-gray-400 dark:text-[#8696a0] text-xs font-medium uppercase tracking-wide">Trigger</span>
            <span className="text-gray-400 dark:text-[#8696a0] text-xs font-medium uppercase tracking-wide">Response</span>
            <span className="text-gray-400 dark:text-[#8696a0] text-xs font-medium uppercase tracking-wide">Active</span>
            <span />
          </div>
          {rules.map((rule, i) => (
            <div
              key={rule.id}
              className="grid grid-cols-[1fr_2fr_auto_auto] gap-4 items-center bg-[#111b21] hover:bg-[#182229] border border-[#222e35] rounded-xl px-4 py-3.5 transition-colors group"
            >
              {/* Trigger */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[#8696a0] text-xs tabular-nums shrink-0">#{i + 1}</span>
                <span className="text-[#00a884] font-mono text-sm font-medium truncate">{rule.trigger}</span>
              </div>

              {/* Response */}
              <p className="text-[#8696a0] text-sm truncate">{rule.response}</p>

              {/* Toggle */}
              <div className="flex items-center">
                <Toggle checked={rule.is_active} onChange={() => toggleRule(rule.id, rule.is_active)} />
              </div>

              {/* Delete */}
              <button
                onClick={() => deleteRule(rule.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-[#8696a0] hover:text-red-400 hover:bg-red-400/10 transition-all"
                title="Delete rule"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
