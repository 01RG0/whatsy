import { useEffect, useMemo, useState } from 'react'
import { API_BASE, getAuthHeader } from '../api/inbox'

type Flow = {
  id: string
  name: string
  status: string
  categories?: string[]
  version?: number
  updated_at?: string
  created_at?: string
}

type QuestionType = 'text' | 'email' | 'phone' | 'number' | 'dropdown'

type Field = {
  id: string
  label: string
  key: string
  type: QuestionType
  required: boolean
  options?: string[] // For dropdown
  placeholder?: string
}

const starterFields: Field[] = [
  { id: 'name', label: 'Full name', key: 'full_name', type: 'text', required: true, placeholder: 'e.g. Alex Johnson' },
  { id: 'email', label: 'Email address', key: 'email', type: 'email', required: true, placeholder: 'alex@example.com' },
  { id: 'phone', label: 'Phone number', key: 'phone', type: 'phone', required: false, placeholder: '+1 555-0199' },
]

function flowsFrom(data: unknown): Flow[] {
  if (Array.isArray(data)) return data as Flow[]
  if (data && typeof data === 'object' && Array.isArray((data as { flows?: unknown[] }).flows)) {
    return (data as { flows: Flow[] }).flows
  }
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)) {
    return (data as { data: Flow[] }).data
  }
  return []
}

function flowFrom(data: unknown): Flow | null {
  if (!data || typeof data !== 'object') return null
  return (data as { flow?: Flow }).flow ?? (data as { data?: Flow }).data ?? (data as Flow)
}

async function errorFrom(response: Response) {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
  return data.error || data.message || `[${response.status}] Request failed`
}

function buildFlow(title: string, description: string, fields: Field[], buttonLabel: string) {
  return {
    version: '6.0',
    screens: [
      {
        id: 'MAIN_FORM',
        title: title || 'Contact us',
        terminal: true,
        success: true,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            ...(description ? [{ type: 'TextHeading', text: description }] : []),
            ...fields.map((field) => {
              if (field.type === 'dropdown') {
                return {
                  type: 'Dropdown',
                  name: field.key,
                  label: field.label,
                  required: field.required,
                  'data-source': (field.options && field.options.length > 0 ? field.options : ['Option 1', 'Option 2']).map(
                    (opt, i) => ({
                      id: `opt_${i + 1}`,
                      title: opt,
                    })
                  ),
                }
              }
              return {
                type: 'TextInput',
                name: field.key,
                label: field.label,
                required: field.required,
                'input-type': field.type === 'number' ? 'number' : field.type,
              }
            }),
            {
              type: 'Footer',
              label: buttonLabel || 'Submit',
              'on-click-action': {
                name: 'complete',
                payload: Object.fromEntries(fields.map((field) => [field.key, `\${form.${field.key}}`])),
              },
            },
          ],
        },
      },
    ],
  }
}

export default function AutoReplyPage() {
  const [flows, setFlows] = useState<Flow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'DRAFT' | 'PUBLISHED'>('all')

  // Screen configuration
  const [title, setTitle] = useState('Customer Support Request')
  const [description, setDescription] = useState('Please fill out the form below and our team will get back to you shortly.')
  const [buttonLabel, setButtonLabel] = useState('Submit Request')
  const [fields, setFields] = useState<Field[]>(starterFields)

  // Builder views & state
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor')
  const [advanced, setAdvanced] = useState(false)
  const [definition, setDefinition] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPublishModal, setShowPublishModal] = useState(false)

  // Interactive mockup interactive values for test-filling inside phone
  const [previewInputs, setPreviewInputs] = useState<Record<string, string>>({})

  const selected = useMemo(() => flows.find((flow) => flow.id === selectedId) ?? null, [flows, selectedId])
  const isDraft = !selected || selected.status === 'DRAFT'
  const flowJson = useMemo(() => buildFlow(title, description, fields, buttonLabel), [title, description, fields, buttonLabel])

  async function loadFlows() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows`, { headers: getAuthHeader() })
      if (!response.ok) throw new Error(await errorFrom(response))
      const next = flowsFrom(await response.json())
      setFlows(next)
      if (next.length) {
        setSelectedId((current) => (next.some((flow) => flow.id === current) ? current : next[0].id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load WhatsApp Flows')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFlows()
  }, [])

  function selectFlow(id: string) {
    setSelectedId(id)
    setPreviewUrl('')
    setNotice('')
    setError('')
    const target = flows.find((f) => f.id === id)
    if (target) {
      setTitle(target.name || 'Contact Us')
    }
  }

  async function createDraft() {
    if (!name.trim()) {
      setError('Enter a name for the Flow')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ name: name.trim(), categories: ['CUSTOMER_SUPPORT'] }),
      })
      if (!response.ok) throw new Error(await errorFrom(response))
      const created = flowFrom(await response.json())
      if (created) {
        setFlows((current) => [created, ...current])
        setSelectedId(created.id)
        setName('')
        setNotice('Draft Flow created successfully. Customize questions below.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the Flow')
    } finally {
      setBusy(false)
    }
  }

  async function uploadDefinition() {
    if (!selected) {
      setError('Please select or create a draft Flow first.')
      return
    }
    if (!isDraft) {
      setError('Published Flows cannot be modified.')
      return
    }
    let json: unknown
    try {
      json = advanced ? JSON.parse(definition) : flowJson
    } catch {
      setError('Flow JSON is not valid JSON syntax')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows/${selected.id}/json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ flow_json: json }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        validation_errors?: Array<{ message?: string; error_type?: string }>
      }
      if (!response.ok) {
        throw new Error(data.validation_errors?.[0]?.message || `[${response.status}] Upload and validation failed`)
      }
      if (data.validation_errors && data.validation_errors.length > 0) {
        setError(data.validation_errors.map((item) => item.message || 'Validation error').join(' | '))
      } else {
        setNotice('✓ Flow JSON passed WhatsApp validation and saved successfully.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the Flow')
    } finally {
      setBusy(false)
    }
  }

  async function preview() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows/${selected.id}/preview`, { headers: getAuthHeader() })
      if (!response.ok) throw new Error(await errorFrom(response))
      const data = (await response.json()) as { preview_url?: string; previewUrl?: string }
      if (!data.preview_url && !data.previewUrl) throw new Error('No preview URL returned by WhatsApp API')
      setPreviewUrl(data.preview_url || data.previewUrl || '')
      setNotice('Interactive web preview loaded.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create official WhatsApp preview')
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!selected || !isDraft) return
    setShowPublishModal(false)
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/v1/whatsapp/flows/${selected.id}/publish`, {
        method: 'POST',
        headers: getAuthHeader(),
      })
      if (!response.ok) throw new Error(await errorFrom(response))
      setFlows((current) =>
        current.map((flow) => (flow.id === selected.id ? { ...flow, status: 'PUBLISHED' } : flow))
      )
      setNotice('🎉 Published successfully! This Flow is now active and ready to send to WhatsApp users.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish the Flow')
    } finally {
      setBusy(false)
    }
  }

  function updateField(id: string, patch: Partial<Field>) {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)))
  }

  function addField() {
    const index = fields.length + 1
    const newId = `field_${Date.now()}`
    setFields((current) => [
      ...current,
      {
        id: newId,
        label: `Question ${index}`,
        key: `question_${index}`,
        type: 'text',
        required: false,
        placeholder: 'Enter answer...',
      },
    ])
  }

  function removeField(id: string) {
    if (fields.length <= 1) return
    setFields((current) => current.filter((field) => field.id !== id))
  }

  function moveField(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= fields.length) return
    setFields((current) => {
      const copy = [...current]
      const [moved] = copy.splice(index, 1)
      copy.splice(targetIndex, 0, moved)
      return copy
    })
  }

  const filteredFlows = useMemo(() => {
    return flows.filter((f) => {
      const matchesSearch =
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.id.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesStatus = filterStatus === 'all' || f.status === filterStatus
      return matchesSearch && matchesStatus
    })
  }, [flows, searchQuery, filterStatus])

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f0f2f5] dark:bg-[#0b141a] overflow-hidden text-gray-800 dark:text-[#e9edef]">
      {/* Top Navigation / App Header */}
      <header className="flex-none bg-white dark:bg-[#111b21] border-b border-gray-200 dark:border-[#222e35] px-4 sm:px-6 py-3.5 z-10">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#00a884]/15 dark:bg-[#00a884]/20 flex items-center justify-center text-[#00a884]">
              {/* WhatsApp Flow Icon */}
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M7 8h10" />
                <path d="M7 12h7" />
                <path d="M7 16h4" />
                <circle cx="17" cy="15" r="2" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold tracking-wider uppercase text-[#008069] dark:text-[#00a884] bg-[#00a884]/10 px-2 py-0.5 rounded-full">
                  WhatsApp Business Automation
                </span>
                <span className="text-xs text-gray-400 dark:text-[#8696a0]">v6.0 Engine</span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-[#e9edef] flex items-center gap-2">
                Interactive Flows & Forms
              </h1>
            </div>
          </div>

          {/* Quick Create Bar */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createDraft()}
                placeholder="New flow name..."
                className="w-48 sm:w-56 px-3.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-[#2a3942] bg-[#f0f2f5] dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-2 focus:ring-[#00a884] focus:border-transparent transition-all"
              />
            </div>
            <button
              type="button"
              onClick={createDraft}
              disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#00967a] active:bg-[#008069] disabled:opacity-50 text-white text-sm font-medium transition shadow-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Create Flow</span>
            </button>
          </div>
        </div>
      </header>

      {/* Global Alerts: Error / Success */}
      {error && (
        <div className="flex-none bg-red-50 dark:bg-[#321d22] border-b border-red-200 dark:border-[#5c2930] px-6 py-2.5 flex items-center justify-between text-red-700 dark:text-[#f87171] text-sm animate-fadeIn">
          <div className="flex items-center gap-2 max-w-5xl">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="font-medium">{error}</span>
          </div>
          <button
            onClick={() => setError('')}
            className="text-red-500 hover:text-red-700 dark:hover:text-red-300 text-xs px-2 py-0.5 rounded ml-4 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="flex-none bg-emerald-50 dark:bg-[#102c25] border-b border-emerald-200 dark:border-[#1a4a3e] px-6 py-2.5 flex items-center justify-between text-[#008069] dark:text-[#25d366] text-sm">
          <div className="flex items-center gap-2 max-w-5xl">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="font-medium">{notice}</span>
          </div>
          <button
            onClick={() => setNotice('')}
            className="text-[#008069] dark:text-[#25d366] hover:opacity-80 text-xs px-2 py-0.5 rounded ml-4 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden max-w-7xl w-full mx-auto p-3 sm:p-5 gap-4">
        {/* LEFT COLUMN: WhatsApp-Styled Flows Sidebar */}
        <aside className="w-full sm:w-80 flex-none flex flex-col bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-2xl overflow-hidden shadow-sm">
          {/* Flows Sidebar Header & Search */}
          <div className="p-3.5 border-b border-gray-100 dark:border-[#222e35] bg-white dark:bg-[#111b21]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-gray-900 dark:text-[#e9edef]">Your Flows</span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-gray-100 dark:bg-[#202c33] text-gray-600 dark:text-[#8696a0]">
                  {flows.length}
                </span>
              </div>
              <button
                onClick={loadFlows}
                disabled={loading}
                title="Refresh list"
                className="p-1 rounded-md text-gray-400 hover:text-[#00a884] dark:hover:text-[#00a884] hover:bg-gray-100 dark:hover:bg-[#202c33] transition"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin text-[#00a884]' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mb-2.5">
              <svg className="w-4 h-4 absolute left-3 top-2.5 text-gray-400 dark:text-[#8696a0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search flows..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-transparent bg-[#f0f2f5] dark:bg-[#202c33] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-1 focus:ring-[#00a884]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Status Filter Chips */}
            <div className="flex gap-1.5">
              {(['all', 'DRAFT', 'PUBLISHED'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition ${
                    filterStatus === status
                      ? 'bg-[#00a884] text-white'
                      : 'bg-gray-100 dark:bg-[#202c33] text-gray-600 dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#2a3942]'
                  }`}
                >
                  {status === 'all' ? 'All' : status === 'DRAFT' ? 'Drafts' : 'Published'}
                </button>
              ))}
            </div>
          </div>

          {/* Flows List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-[#222e35]/50">
            {loading ? (
              <div className="p-6 text-center text-xs text-gray-400 dark:text-[#8696a0] flex flex-col items-center gap-2">
                <div className="w-5 h-5 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
                <span>Loading Flows from WhatsApp...</span>
              </div>
            ) : filteredFlows.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400 dark:text-[#8696a0]">
                <p className="font-medium text-gray-500 dark:text-[#d1d7db] mb-1">No flows found</p>
                <p>Create a draft flow above to get started.</p>
              </div>
            ) : (
              filteredFlows.map((flow) => {
                const isSelected = selectedId === flow.id
                const isDraftFlow = flow.status === 'DRAFT'
                return (
                  <button
                    key={flow.id}
                    type="button"
                    onClick={() => selectFlow(flow.id)}
                    className={`w-full text-left p-3.5 transition flex items-start gap-3 relative ${
                      isSelected
                        ? 'bg-[#00a884]/10 dark:bg-[#202c33]'
                        : 'hover:bg-gray-50 dark:hover:bg-[#182229]'
                    }`}
                  >
                    {/* Active WhatsApp Indicator Line */}
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#00a884]" />
                    )}

                    {/* Flow Avatar / Icon */}
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isDraftFlow
                          ? 'bg-amber-100 dark:bg-[#382b13] text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-100 dark:bg-[#0c3127] text-[#00a884]'
                      }`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className={`text-sm font-medium truncate ${isSelected ? 'text-gray-900 dark:text-white font-semibold' : 'text-gray-800 dark:text-[#e9edef]'}`}>
                          {flow.name}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                            isDraftFlow
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-emerald-100 text-[#008069] dark:bg-[#00a884]/20 dark:text-[#25d366]'
                          }`}
                        >
                          {flow.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-[#8696a0]">
                        <span className="font-mono text-[10px] truncate max-w-[140px]">ID: {flow.id}</span>
                        <span>{flow.categories?.[0] || 'Support'}</span>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* MIDDLE / RIGHT WORKSPACE */}
        {!selected ? (
          <section className="flex-1 bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-2xl p-10 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-[#00a884]/10 text-[#00a884] flex items-center justify-center mb-4">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M7 8h10M7 12h10M7 16h6" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-[#e9edef] mb-1">
              Select or Create a WhatsApp Flow
            </h2>
            <p className="text-xs text-gray-500 dark:text-[#8696a0] max-w-md">
              WhatsApp Flows let you build rich, native multi-screen forms and surveys that open directly in user chats.
            </p>
          </section>
        ) : (
          <section className="flex-1 flex flex-col bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-2xl overflow-hidden shadow-sm">
            {/* Flow Editor Top Toolbar */}
            <div className="px-5 py-3.5 border-b border-gray-200 dark:border-[#222e35] flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#111b21]">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-gray-900 dark:text-[#e9edef]">{selected.name}</h2>
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                        isDraft
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-emerald-100 text-[#008069] dark:bg-[#00a884]/20 dark:text-[#25d366]'
                      }`}
                    >
                      {selected.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-[#8696a0] mt-0.5">
                    {isDraft ? 'Draft mode · modify screens and validate before publishing' : 'Published · Read-only live Flow'}
                  </p>
                </div>
              </div>

              {/* Mobile View Toggle (Editor vs Phone Preview) */}
              <div className="flex xl:hidden items-center bg-gray-100 dark:bg-[#202c33] rounded-lg p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab('editor')}
                  className={`px-3 py-1 rounded-md transition ${activeTab === 'editor' ? 'bg-white dark:bg-[#111b21] text-[#00a884] shadow-sm' : 'text-gray-500 dark:text-[#8696a0]'}`}
                >
                  Form Builder
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`px-3 py-1 rounded-md transition ${activeTab === 'preview' ? 'bg-white dark:bg-[#111b21] text-[#00a884] shadow-sm' : 'text-gray-500 dark:text-[#8696a0]'}`}
                >
                  Live Mockup
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdvanced((v) => !v)
                    if (!advanced) setDefinition(JSON.stringify(flowJson, null, 2))
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                    advanced
                      ? 'border-[#00a884] bg-[#00a884]/10 text-[#00a884]'
                      : 'border-gray-300 dark:border-[#2a3942] text-gray-700 dark:text-[#d1d7db] hover:bg-gray-50 dark:hover:bg-[#202c33]'
                  }`}
                >
                  {advanced ? 'Visual Builder' : 'JSON Schema'}
                </button>

                <button
                  type="button"
                  onClick={preview}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#2a3942] hover:bg-gray-50 dark:hover:bg-[#202c33] text-gray-700 dark:text-[#d1d7db] text-xs font-medium inline-flex items-center gap-1.5 transition"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>Meta Preview</span>
                </button>

                {isDraft && (
                  <>
                    <button
                      type="button"
                      onClick={uploadDefinition}
                      disabled={busy}
                      className="px-3.5 py-1.5 rounded-lg bg-[#128c7e] hover:bg-[#075e54] active:bg-[#00a884] disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 shadow-sm transition"
                    >
                      {busy ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      <span>Save & Validate</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowPublishModal(true)}
                      disabled={busy}
                      className="px-3.5 py-1.5 rounded-lg bg-[#00a884] hover:bg-[#00967a] active:bg-[#008069] disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 shadow-sm transition"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
                      </svg>
                      <span>Publish</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Split Content: Form Builder (Left) + Phone Mockup (Right) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] gap-6 items-start">
              {/* BUILDER PANE */}
              <div className={`space-y-6 ${activeTab === 'preview' ? 'hidden xl:block' : 'block'}`}>
                {advanced ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700 dark:text-[#e9edef] uppercase tracking-wider">
                        WhatsApp Flow JSON v6.0 Schema
                      </p>
                      <span className="text-[11px] text-gray-400 dark:text-[#8696a0]">
                        Direct payload validated by WhatsApp Graph API
                      </span>
                    </div>
                    <textarea
                      value={definition}
                      onChange={(e) => setDefinition(e.target.value)}
                      disabled={!isDraft}
                      rows={20}
                      spellCheck={false}
                      className="w-full rounded-xl bg-[#0b141a] text-[#25d366] border border-[#222e35] p-4 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#00a884] transition"
                    />
                  </div>
                ) : (
                  <>
                    {/* SECTION 1: Screen Setup */}
                    <div className="bg-[#f0f2f5]/60 dark:bg-[#182229]/60 border border-gray-200 dark:border-[#222e35] rounded-2xl p-5 space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-[#00a884] text-white flex items-center justify-center text-xs font-bold">
                          1
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-gray-900 dark:text-[#e9edef]">Screen Configuration</h3>
                          <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                            Customize the title, instructions, and primary call-to-action for the screen.
                          </p>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-[#d1d7db] mb-1">
                            Screen Title
                          </label>
                          <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            disabled={!isDraft}
                            placeholder="e.g. Course Registration"
                            className="w-full px-3.5 py-2 rounded-xl text-xs border border-gray-300 dark:border-[#2a3942] bg-white dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-2 focus:ring-[#00a884] transition disabled:opacity-60"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 dark:text-[#d1d7db] mb-1">
                            Submit Button Label
                          </label>
                          <input
                            value={buttonLabel}
                            onChange={(e) => setButtonLabel(e.target.value)}
                            disabled={!isDraft}
                            placeholder="e.g. Complete & Send"
                            className="w-full px-3.5 py-2 rounded-xl text-xs border border-gray-300 dark:border-[#2a3942] bg-white dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-2 focus:ring-[#00a884] transition disabled:opacity-60"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-[#d1d7db] mb-1">
                          Header Description / Instructions
                        </label>
                        <textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          disabled={!isDraft}
                          rows={2}
                          placeholder="Provide clear guidance for what the user is completing..."
                          className="w-full px-3.5 py-2 rounded-xl text-xs border border-gray-300 dark:border-[#2a3942] bg-white dark:bg-[#111b21] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-2 focus:ring-[#00a884] resize-none transition disabled:opacity-60"
                        />
                      </div>
                    </div>

                    {/* SECTION 2: Question Fields Builder */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#00a884] text-white flex items-center justify-center text-xs font-bold">
                            2
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-gray-900 dark:text-[#e9edef]">Form Fields & Questions</h3>
                            <p className="text-xs text-gray-500 dark:text-[#8696a0]">
                              Add input questions, choose field types, set required state, and reorder.
                            </p>
                          </div>
                        </div>

                        {isDraft && (
                          <button
                            type="button"
                            onClick={addField}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#00a884]/15 hover:bg-[#00a884]/25 text-[#008069] dark:text-[#00a884] transition"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            <span>Add Question</span>
                          </button>
                        )}
                      </div>

                      {/* Question Cards List */}
                      <div className="space-y-3">
                        {fields.map((field, index) => (
                          <div
                            key={field.id}
                            className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-xl p-4 shadow-sm hover:border-gray-300 dark:hover:border-[#2a3942] transition"
                          >
                            {/* Card Header: Badge, Move Controls, Remove */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-md bg-gray-100 dark:bg-[#202c33] text-gray-700 dark:text-[#8696a0] flex items-center justify-center text-[10px] font-bold">
                                  {index + 1}
                                </span>
                                <span className="text-xs font-semibold text-gray-700 dark:text-[#d1d7db]">
                                  {field.label || `Question ${index + 1}`}
                                </span>
                                {field.required && (
                                  <span className="text-[10px] text-red-500 font-bold tracking-tight">* Required</span>
                                )}
                              </div>

                              <div className="flex items-center gap-1">
                                {isDraft && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={index === 0}
                                      onClick={() => moveField(index, 'up')}
                                      title="Move up"
                                      className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-[#e9edef] disabled:opacity-30 transition"
                                    >
                                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="18 15 12 9 6 15" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={index === fields.length - 1}
                                      onClick={() => moveField(index, 'down')}
                                      title="Move down"
                                      className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-[#e9edef] disabled:opacity-30 transition"
                                    >
                                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="6 9 12 15 18 9" />
                                      </svg>
                                    </button>
                                    {fields.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => removeField(field.id)}
                                        title="Remove question"
                                        className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition ml-1"
                                      >
                                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <polyline points="3 6 5 6 21 6" />
                                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </svg>
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Inputs Row */}
                            <div className="grid grid-cols-1 sm:grid-cols-[1.5fr_1fr_120px] gap-3">
                              <div>
                                <label className="block text-[11px] font-medium text-gray-500 dark:text-[#8696a0] mb-1">
                                  Question Prompt / Label
                                </label>
                                <input
                                  value={field.label}
                                  onChange={(e) => updateField(field.id, { label: e.target.value })}
                                  disabled={!isDraft}
                                  placeholder="e.g. Your Full Name"
                                  className="w-full px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-[#2a3942] bg-[#f0f2f5]/40 dark:bg-[#182229] text-gray-900 dark:text-[#e9edef] focus:outline-none focus:ring-2 focus:ring-[#00a884] transition"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-medium text-gray-500 dark:text-[#8696a0] mb-1">
                                  Variable Key (JSON output)
                                </label>
                                <input
                                  value={field.key}
                                  onChange={(e) =>
                                    updateField(field.id, {
                                      key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase(),
                                    })
                                  }
                                  disabled={!isDraft}
                                  placeholder="full_name"
                                  className="w-full px-3 py-1.5 rounded-lg text-xs font-mono border border-gray-200 dark:border-[#2a3942] bg-[#f0f2f5]/40 dark:bg-[#182229] text-gray-900 dark:text-[#e9edef] focus:outline-none focus:ring-2 focus:ring-[#00a884] transition"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-medium text-gray-500 dark:text-[#8696a0] mb-1">
                                  Type
                                </label>
                                <select
                                  value={field.type}
                                  onChange={(e) => updateField(field.id, { type: e.target.value as QuestionType })}
                                  disabled={!isDraft}
                                  className="w-full px-2.5 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-[#2a3942] bg-[#f0f2f5]/40 dark:bg-[#182229] text-gray-900 dark:text-[#e9edef] focus:outline-none focus:ring-2 focus:ring-[#00a884] transition"
                                >
                                  <option value="text">Text</option>
                                  <option value="email">Email</option>
                                  <option value="phone">Phone</option>
                                  <option value="number">Number</option>
                                  <option value="dropdown">Dropdown</option>
                                </select>
                              </div>
                            </div>

                            {/* Dropdown Options Editor (if type is dropdown) */}
                            {field.type === 'dropdown' && (
                              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-[#222e35]">
                                <label className="block text-[11px] font-medium text-gray-500 dark:text-[#8696a0] mb-1">
                                  Dropdown Choices (comma-separated)
                                </label>
                                <input
                                  value={(field.options || ['Morning', 'Afternoon', 'Evening']).join(', ')}
                                  onChange={(e) =>
                                    updateField(field.id, {
                                      options: e.target.value
                                        .split(',')
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                  disabled={!isDraft}
                                  placeholder="Option 1, Option 2, Option 3"
                                  className="w-full px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-[#2a3942] bg-[#f0f2f5]/40 dark:bg-[#182229] text-gray-900 dark:text-[#e9edef] focus:outline-none focus:ring-2 focus:ring-[#00a884] transition"
                                />
                              </div>
                            )}

                            {/* Footer: Required toggle switch */}
                            <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-[#222e35] flex items-center justify-between">
                              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  onChange={(e) => updateField(field.id, { required: e.target.checked })}
                                  disabled={!isDraft}
                                  className="sr-only peer"
                                />
                                <div className="w-8 h-4 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-[#202c33] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#00a884] relative" />
                                <span className="text-[11px] font-medium text-gray-600 dark:text-[#8696a0]">
                                  Required answer
                                </span>
                              </label>

                              <span className="text-[10px] text-gray-400 dark:text-[#8696a0]">
                                Type: <strong className="uppercase text-gray-600 dark:text-[#d1d7db]">{field.type}</strong>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Add Question Big Dashed Button */}
                      {isDraft && (
                        <button
                          type="button"
                          onClick={addField}
                          className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-[#2a3942] hover:border-[#00a884] dark:hover:border-[#00a884] rounded-xl flex items-center justify-center gap-2 text-xs font-medium text-gray-500 dark:text-[#8696a0] hover:text-[#008069] dark:hover:text-[#00a884] transition bg-white/50 dark:bg-transparent"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="16" />
                            <line x1="8" y1="12" x2="16" y2="12" />
                          </svg>
                          <span>Add another question</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* RIGHT PANE: Authentic WhatsApp Smartphone Mockup */}
              <div className={`space-y-4 ${activeTab === 'editor' ? 'hidden xl:block' : 'block'}`}>
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-semibold text-gray-600 dark:text-[#8696a0]">
                      Live Smartphone Mockup
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400 dark:text-[#8696a0]">Real-time preview</span>
                </div>

                {/* The Smartphone Chassis */}
                <div className="relative mx-auto w-full max-w-[340px] rounded-[38px] p-3 bg-gray-900 shadow-2xl ring-1 ring-gray-800/20 dark:ring-white/10">
                  {/* Phone Speaker & Camera Notch */}
                  <div className="absolute top-5 left-1/2 -translate-x-1/2 w-28 h-4 bg-black rounded-full flex items-center justify-center gap-2 z-20">
                    <div className="w-10 h-1 bg-gray-800 rounded-full" />
                    <div className="w-2.5 h-2.5 bg-[#1a2228] rounded-full" />
                  </div>

                  {/* Phone Screen Container */}
                  <div className="relative rounded-[28px] overflow-hidden bg-[#ffffff] dark:bg-[#111b21] flex flex-col h-[580px] text-gray-800 dark:text-[#e9edef] border border-gray-200 dark:border-[#222e35]">
                    {/* Status Bar */}
                    <div className="h-7 bg-[#008069] dark:bg-[#202c33] text-white flex items-center justify-between px-5 text-[10px] font-medium pt-1 z-10 select-none">
                      <span>9:41</span>
                      <div className="flex items-center gap-1.5">
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4 21l3.39-.97C8.93 20.26 10.88 21 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z" />
                        </svg>
                        <span>5G</span>
                        <div className="w-4 h-2 border border-white rounded-sm p-0.5 flex items-center">
                          <div className="w-full h-full bg-white rounded-2xs" />
                        </div>
                      </div>
                    </div>

                    {/* WhatsApp Flow Sheet Header */}
                    <div className="bg-[#008069] dark:bg-[#202c33] text-white px-4 py-3 flex items-center justify-between shadow-sm z-10">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button type="button" className="text-white hover:opacity-80 transition">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-bold truncate leading-tight">
                              {title || 'WhatsApp Form'}
                            </h4>
                            {/* Official WhatsApp Flow Verified Icon */}
                            <svg className="w-3.5 h-3.5 text-[#25d366] flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                            </svg>
                          </div>
                          <p className="text-[10px] text-white/80 truncate">Whatsy Official Flow</p>
                        </div>
                      </div>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-white/20 rounded text-white/90">
                        Flow
                      </span>
                    </div>

                    {/* Flow Body Content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white dark:bg-[#111b21]">
                      {/* Flow Description */}
                      {description && (
                        <div className="bg-[#f0f2f5] dark:bg-[#182229] p-3 rounded-xl border border-gray-100 dark:border-[#222e35]">
                          <p className="text-xs text-gray-700 dark:text-[#d1d7db] leading-relaxed">
                            {description}
                          </p>
                        </div>
                      )}

                      {/* Mock Form Inputs */}
                      <div className="space-y-3.5">
                        {fields.map((field) => (
                          <div key={field.id} className="space-y-1">
                            <label className="block text-[11px] font-semibold text-gray-700 dark:text-[#d1d7db]">
                              {field.label || 'Question'}
                              {field.required && <span className="text-[#00a884] ml-0.5">*</span>}
                            </label>

                            {field.type === 'dropdown' ? (
                              <div className="relative">
                                <select
                                  value={previewInputs[field.key] || ''}
                                  onChange={(e) =>
                                    setPreviewInputs((curr) => ({ ...curr, [field.key]: e.target.value }))
                                  }
                                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#182229] text-gray-800 dark:text-[#e9edef] focus:outline-none focus:ring-1 focus:ring-[#00a884] appearance-none"
                                >
                                  <option value="">Select an option...</option>
                                  {(field.options && field.options.length > 0
                                    ? field.options
                                    : ['Option 1', 'Option 2']
                                  ).map((opt, i) => (
                                    <option key={i} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                                <svg
                                  className="w-3.5 h-3.5 absolute right-3 top-3 text-gray-400 pointer-events-none"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <polyline points="6 9 12 15 18 9" />
                                </svg>
                              </div>
                            ) : (
                              <div className="relative">
                                <input
                                  type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
                                  value={previewInputs[field.key] || ''}
                                  onChange={(e) =>
                                    setPreviewInputs((curr) => ({ ...curr, [field.key]: e.target.value }))
                                  }
                                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#182229] text-gray-800 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-1 focus:ring-[#00a884] transition"
                                />
                                {field.type === 'email' && (
                                  <svg className="w-3.5 h-3.5 absolute right-3 top-2.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                    <polyline points="22,6 12,13 2,6" />
                                  </svg>
                                )}
                                {field.type === 'phone' && (
                                  <svg className="w-3.5 h-3.5 absolute right-3 top-2.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                                  </svg>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* WhatsApp Security Tag */}
                      <div className="text-center pt-2 select-none">
                        <span className="text-[10px] text-gray-400 dark:text-[#8696a0] flex items-center justify-center gap-1">
                          <svg className="w-2.5 h-2.5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                          </svg>
                          End-to-end encrypted on WhatsApp
                        </span>
                      </div>
                    </div>

                    {/* WhatsApp CTA Action Footer */}
                    <div className="p-3.5 bg-[#f0f2f5] dark:bg-[#182229] border-t border-gray-200 dark:border-[#222e35]">
                      <button
                        type="button"
                        onClick={() => {
                          setNotice('Interactive test submission simulated! Values captured: ' + JSON.stringify(previewInputs))
                        }}
                        className="w-full py-2.5 px-4 rounded-xl bg-[#00a884] hover:bg-[#00967a] active:bg-[#008069] text-white text-xs font-bold transition shadow-sm flex items-center justify-center gap-2"
                      >
                        <span>{buttonLabel || 'Submit'}</span>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </button>
                    </div>

                    {/* Home Indicator bar */}
                    <div className="h-4 bg-[#f0f2f5] dark:bg-[#182229] flex items-center justify-center pb-1">
                      <div className="w-24 h-1 bg-gray-400 dark:bg-gray-600 rounded-full" />
                    </div>
                  </div>
                </div>

                {/* WhatsApp Meta Preview Iframe (if loaded) */}
                {previewUrl && (
                  <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-[#222e35] bg-white dark:bg-[#111b21] p-3 shadow-sm space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-800 dark:text-[#e9edef]">
                        Official WhatsApp Web Preview
                      </span>
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#00a884] hover:underline text-[11px]"
                      >
                        Open in tab ↗
                      </a>
                    </div>
                    <iframe
                      title="WhatsApp Official Flow Preview"
                      src={previewUrl}
                      className="w-full h-80 rounded-xl border border-gray-200 dark:border-[#222e35] bg-white"
                    />
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Publish Confirmation Modal */}
      {showPublishModal && selected && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-[#e9edef]">
                Publish Flow "{selected.name}"?
              </h3>
              <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-1.5 leading-relaxed">
                Publishing locks this Flow on WhatsApp servers. Once published, screens and questions cannot be modified. Ensure you have tested the Flow schema using <strong>Save & Validate</strong>.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-[#8696a0] hover:bg-gray-100 dark:hover:bg-[#202c33] transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={publish}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-[#00a884] hover:bg-[#00967a] active:bg-[#008069] text-white shadow-sm transition"
              >
                Confirm & Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
