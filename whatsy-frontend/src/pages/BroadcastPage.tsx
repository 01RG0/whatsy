import { useState } from 'react'
import { getAuthHeader } from '../api/inbox'

interface BroadcastResult {
  success: number
  failed: number
  errors: string[]
}

export default function BroadcastPage() {
  const [templateName, setTemplateName] = useState('')
  const [params, setParams] = useState<string[]>([''])
  const [phones, setPhones] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BroadcastResult | null>(null)
  const [error, setError] = useState('')

  function addParam() {
    setParams((p) => [...p, ''])
  }
  function removeParam(i: number) {
    setParams((p) => p.filter((_, idx) => idx !== i))
  }
  function setParam(i: number, val: string) {
    setParams((p) => p.map((v, idx) => (idx === i ? val : v)))
  }

  async function handleSend() {
    const recipientPhones = phones
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)

    if (!templateName.trim()) { setError('Template name is required'); return }
    if (recipientPhones.length === 0) { setError('Enter at least one phone number'); return }

    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/v1/whatsapp/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          templateName: templateName.trim(),
          templateParams: params.filter(Boolean),
          recipientPhones,
          scheduledAt: scheduledAt || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Broadcast failed')
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0b141a] p-6">
      <h1 className="text-[#e9edef] text-2xl font-semibold mb-6">Send Broadcast</h1>

      <div className="max-w-xl space-y-5">
        {/* Template name */}
        <div>
          <label className="block text-[#8696a0] text-sm mb-1">Template Name</label>
          <input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g. class_reminder"
            className="w-full bg-[#202c33] text-[#e9edef] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#00a884] placeholder-[#8696a0]"
          />
        </div>

        {/* Template params */}
        <div>
          <label className="block text-[#8696a0] text-sm mb-1">Template Parameters</label>
          {params.map((p, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                value={p}
                onChange={(e) => setParam(i, e.target.value)}
                placeholder={`{{${i + 1}}}`}
                className="flex-1 bg-[#202c33] text-[#e9edef] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#00a884] placeholder-[#8696a0]"
              />
              {params.length > 1 && (
                <button onClick={() => removeParam(i)} className="text-[#8696a0] hover:text-red-400 px-2">✕</button>
              )}
            </div>
          ))}
          <button onClick={addParam} className="text-[#00a884] text-sm hover:underline">+ Add param</button>
        </div>

        {/* Recipients */}
        <div>
          <label className="block text-[#8696a0] text-sm mb-1">Recipient Phone Numbers (one per line)</label>
          <textarea
            value={phones}
            onChange={(e) => setPhones(e.target.value)}
            rows={6}
            placeholder="+201234567890&#10;+201098765432"
            className="w-full bg-[#202c33] text-[#e9edef] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#00a884] placeholder-[#8696a0] resize-y"
          />
          <p className="text-[#8696a0] text-xs mt-1">
            {phones.split('\n').filter((p) => p.trim()).length} recipient(s)
          </p>
        </div>

        {/* Scheduled time */}
        <div>
          <label className="block text-[#8696a0] text-sm mb-1">Schedule (optional)</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="bg-[#202c33] text-[#e9edef] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#00a884]"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={handleSend}
          disabled={loading}
          className="bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
        >
          {loading ? 'Sending…' : 'Send Broadcast'}
        </button>

        {result && (
          <div className="bg-[#202c33] rounded-lg p-4 space-y-1">
            <p className="text-green-400 font-medium">✓ {result.success} sent</p>
            {result.failed > 0 && <p className="text-red-400 font-medium">✗ {result.failed} failed</p>}
            {result.errors?.map((e, i) => (
              <p key={i} className="text-[#8696a0] text-xs">{e}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
