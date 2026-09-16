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

export default function AutoReplyPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [trigger, setTrigger] = useState('')
  const [response, setResponse] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
    try {
      await fetch(`/v1/auto-reply-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ is_active: !current }),
      })
      setRules((r) => r.map((rule) => rule.id === id ? { ...rule, is_active: !current } : rule))
    } catch {
      setError('Failed to update rule')
    }
  }

  async function deleteRule(id: string) {
    try {
      await fetch(`/v1/auto-reply-rules/${id}`, { method: 'DELETE', headers: getAuthHeader() })
      setRules((r) => r.filter((rule) => rule.id !== id))
    } catch {
      setError('Failed to delete rule')
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
      setRules((r) => [...r, data])
      setTrigger('')
      setResponse('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0b141a] p-6">
      <h1 className="text-[#e9edef] text-2xl font-semibold mb-6">Auto-Reply Rules</h1>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {/* Rules table */}
      <div className="bg-[#111b21] rounded-lg overflow-hidden mb-8">
        {loading ? (
          <p className="text-[#8696a0] text-sm p-4">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-[#8696a0] text-sm p-4">No rules yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#222e35]">
                <th className="text-left text-[#8696a0] font-medium px-4 py-3">Trigger</th>
                <th className="text-left text-[#8696a0] font-medium px-4 py-3">Response</th>
                <th className="text-center text-[#8696a0] font-medium px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-[#222e35] hover:bg-[#202c33]">
                  <td className="px-4 py-3 text-[#e9edef] font-mono">{rule.trigger}</td>
                  <td className="px-4 py-3 text-[#8696a0] max-w-xs truncate">{rule.response}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleRule(rule.id, rule.is_active)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${rule.is_active ? 'bg-[#00a884]' : 'bg-[#374151]'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${rule.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteRule(rule.id)} className="text-[#8696a0] hover:text-red-400 text-xs px-2 py-1 rounded">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add rule form */}
      <div className="bg-[#111b21] rounded-lg p-5 max-w-xl">
        <h2 className="text-[#e9edef] font-medium mb-4">Add Rule</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-[#8696a0] text-xs mb-1">Trigger keyword (e.g. /deadline)</label>
            <input
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="/keyword"
              className="w-full bg-[#202c33] text-[#e9edef] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#00a884] placeholder-[#8696a0] font-mono"
            />
          </div>
          <div>
            <label className="block text-[#8696a0] text-xs mb-1">Auto-reply message</label>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={3}
              placeholder="The reply message sent automatically when trigger matches…"
              className="w-full bg-[#202c33] text-[#e9edef] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#00a884] placeholder-[#8696a0] resize-y"
            />
          </div>
          <button
            onClick={addRule}
            disabled={saving}
            className="bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
          >
            {saving ? 'Saving…' : 'Add Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}
