import { useEffect, useMemo, useState } from 'react'
import { API_BASE, getAuthHeader } from '../api/inbox'

type Flow = { id: string; name: string; status: string; categories?: string[]; version?: number }

const STARTER_FLOW = {
  version: '6.0',
  screens: [{
    id: 'CONTACT_FORM',
    title: 'Contact us',
    terminal: true,
    success: true,
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextInput', name: 'full_name', label: 'Full name', required: true, 'input-type': 'text' },
        { type: 'TextInput', name: 'email', label: 'Email', required: true, 'input-type': 'email' },
        { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: { full_name: '${form.full_name}', email: '${form.email}' } } },
      ],
    },
  }],
}

function flowsFrom(data: unknown): Flow[] {
  if (Array.isArray(data)) return data as Flow[]
  if (data && typeof data === 'object' && Array.isArray((data as { flows?: unknown[] }).flows)) return (data as { flows: Flow[] }).flows
  return []
}

function flowFrom(data: unknown): Flow | null {
  if (!data || typeof data !== 'object') return null
  return (data as { flow?: Flow }).flow ?? data as Flow
}

async function errorFrom(response: Response) {
  const data = await response.json().catch(() => ({})) as { error?: string }
  return data.error || `[${response.status}] Request failed`
}

export default function AutoReplyPage() {
  const [flows, setFlows] = useState<Flow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState(JSON.stringify(STARTER_FLOW, null, 2))
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selected = useMemo(() => flows.find(flow => flow.id === selectedId) ?? null, [flows, selectedId])
  const isDraft = selected?.status === 'DRAFT'

  async function loadFlows() {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows`, { headers: getAuthHeader() })
      if (!response.ok) throw new Error(await errorFrom(response))
      const next = flowsFrom(await response.json())
      setFlows(next)
      if (next.length) setSelectedId(current => next.some(flow => flow.id === current) ? current : next[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load WhatsApp Flows')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFlows() }, [])
  useEffect(() => { if (selected) { setName(selected.name); setPreviewUrl('') } }, [selectedId])

  async function createDraft() {
    if (!name.trim()) { setError('Enter a name for the Flow'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ name: name.trim(), categories: ['CUSTOMER_SUPPORT'] }),
      })
      if (!response.ok) throw new Error(await errorFrom(response))
      const created = flowFrom(await response.json())
      if (created) { setFlows(current => [...current, created]); setSelectedId(created.id); setNotice('Draft created. Add its screens below.') }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the Flow') } finally { setBusy(false) }
  }

  async function uploadDefinition() {
    if (!selected || !isDraft) return
    let flowJson: unknown
    try { flowJson = JSON.parse(definition) } catch { setError('Flow JSON is not valid JSON'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows/${selected.id}/json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ flow_json: flowJson }),
      })
      const data = await response.json().catch(() => ({})) as { validation_errors?: Array<{ message?: string }> }
      if (!response.ok) throw new Error(data.validation_errors?.[0]?.message || `[${response.status}] Upload failed`)
      if (data.validation_errors?.length) setError(data.validation_errors.map(item => item.message || 'Validation error').join(' '))
      else setNotice('Flow definition uploaded and accepted by Meta.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not upload the Flow') } finally { setBusy(false) }
  }

  async function preview() {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows/${selected.id}/preview`, { headers: getAuthHeader() })
      if (!response.ok) throw new Error(await errorFrom(response))
      const data = await response.json() as { preview_url?: string; previewUrl?: string }
      if (!data.preview_url && !data.previewUrl) throw new Error('No preview URL returned')
      setPreviewUrl(data.preview_url || data.previewUrl || '')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create preview') } finally { setBusy(false) }
  }

  async function publish() {
    if (!selected || !isDraft) return
    if (!window.confirm('Publish this Flow? Published Flows cannot be edited.')) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows/${selected.id}/publish`, { method: 'POST', headers: getAuthHeader() })
      if (!response.ok) throw new Error(await errorFrom(response))
      setFlows(current => current.map(flow => flow.id === selected.id ? { ...flow, status: 'PUBLISHED' } : flow))
      setNotice('Published. This Flow is ready to send in WhatsApp.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not publish the Flow') } finally { setBusy(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-[#0b141a] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-[#00a884] text-xs font-semibold uppercase tracking-widest mb-1">WhatsApp automation</p>
            <h1 className="text-gray-900 dark:text-[#e9edef] text-2xl font-semibold">Message Flows</h1>
            <p className="text-gray-500 dark:text-[#8696a0] text-sm mt-1 max-w-xl">Build native forms, surveys, and booking screens customers complete inside WhatsApp.</p>
          </div>
          <div className="flex gap-2">
            <input value={name} onChange={event => setName(event.target.value)} placeholder="New Flow name" className="w-44 px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-[#374151] bg-white dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] outline-none focus:ring-2 focus:ring-[#00a884]" />
            <button type="button" onClick={createDraft} disabled={busy} className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white text-sm font-medium">Create draft</button>
          </div>
        </div>
        {error && <div className="mb-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>}
        {notice && <div className="mb-4 px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{notice}</div>}
        {loading ? <p className="py-10 text-sm text-gray-500 dark:text-[#8696a0]">Loading Flows...</p> : <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
          <aside className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-xl p-3 h-fit">
            <div className="flex justify-between px-2 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-[#8696a0]"><span>Your Flows</span><span>{flows.length}</span></div>
            {!flows.length ? <p className="px-2 py-6 text-sm text-gray-500 dark:text-[#8696a0]">Create a draft to get started.</p> : flows.map(flow => <button key={flow.id} type="button" onClick={() => setSelectedId(flow.id)} className={`w-full text-left px-3 py-3 rounded-lg mb-1 ${selectedId === flow.id ? 'bg-[#00a884]/10 text-[#008f73]' : 'hover:bg-gray-50 dark:hover:bg-[#202c33] text-gray-700 dark:text-[#e9edef]'}`}><span className="block truncate text-sm font-medium">{flow.name}</span><span className="text-xs opacity-70">{flow.status}</span></button>)}
          </aside>
          {!selected ? <section className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-xl p-10 text-center text-gray-500 dark:text-[#8696a0]">Create a draft Flow to begin.</section> : <section className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-[#222e35] flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-900 dark:text-[#e9edef]">{selected.name}</h2><p className="text-xs text-gray-500 dark:text-[#8696a0] mt-1">{isDraft ? 'Draft - editable until published' : 'Published and immutable'}</p></div><div className="flex gap-2"><button type="button" onClick={preview} disabled={busy} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#374151] text-gray-700 dark:text-[#e9edef] text-sm">Preview</button>{isDraft && <button type="button" onClick={publish} disabled={busy} className="px-3 py-1.5 rounded-lg bg-[#00a884] text-white text-sm">Publish</button>}</div></div>
            <div className="p-5 grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5"><div><div className="flex justify-between mb-2"><label className="text-sm font-medium text-gray-800 dark:text-[#e9edef]">Flow JSON</label>{isDraft && <button type="button" onClick={() => setDefinition(JSON.stringify(STARTER_FLOW, null, 2))} className="text-xs text-[#008f73]">Use starter form</button>}</div><textarea value={definition} onChange={event => setDefinition(event.target.value)} disabled={!isDraft} spellCheck={false} className="w-full min-h-[420px] rounded-lg bg-[#111b21] text-[#d1d7db] border border-[#374151] p-4 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-[#00a884] disabled:opacity-70" />{isDraft && <button type="button" onClick={uploadDefinition} disabled={busy} className="mt-3 px-4 py-2 rounded-lg bg-[#202c33] hover:bg-[#2a3942] text-white text-sm">Upload and validate</button>}</div><div className="space-y-4"><div className="rounded-xl bg-gray-50 dark:bg-[#202c33] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-[#8696a0] mb-3">Flow lifecycle</p><ol className="space-y-3 text-sm text-gray-700 dark:text-[#d1d7db]"><li><span className="text-[#00a884] mr-2">1</span>Create a draft</li><li><span className="text-[#00a884] mr-2">2</span>Upload and validate screens</li><li><span className="text-[#00a884] mr-2">3</span>Preview, then publish</li><li><span className="text-[#00a884] mr-2">4</span>Send from a WhatsApp conversation</li></ol></div>{previewUrl && <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-[#374151]"><p className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-[#8696a0]">Live preview</p><iframe title="WhatsApp Flow preview" src={previewUrl} className="w-full h-[500px] bg-white" /></div>}</div></div>
          </section>}
        </div>}
      </div>
    </div>
  )
}
