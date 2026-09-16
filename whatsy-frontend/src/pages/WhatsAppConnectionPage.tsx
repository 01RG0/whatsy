import { useState, useEffect, useRef } from 'react'

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('whatsy_jwt')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

type ConnectionStatus = 'connected' | 'disconnected' | 'degraded'

interface ConnectionInfo {
  status: ConnectionStatus
  phoneNumber: string
  displayName: string
  verified: boolean
  webhookHealthy: boolean
  lastEventAt: string
  apiTier: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#374151] transition-colors font-medium"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-in fade-in slide-in-from-top-2
      ${type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {type === 'success' ? '✓' : '✕'} {message}
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100">✕</button>
    </div>
  )
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const map = {
    connected: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    disconnected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    degraded: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${map[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-500' : status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

export default function WhatsAppConnectionPage() {
  const [conn, setConn] = useState<ConnectionInfo | null>(null)
  const [loadingConn, setLoadingConn] = useState(true)
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([])
  const toastId = useRef(0)

  // Connect tab state
  const [activeTab, setActiveTab] = useState<'qr' | 'cloud'>('qr')
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrCountdown, setQrCountdown] = useState(0)

  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connectLoading, setConnectLoading] = useState(false)

  // Webhook state
  const [showSecret, setShowSecret] = useState(false)
  const [webhookTestResult, setWebhookTestResult] = useState<string | null>(null)
  const [testingWebhook, setTestingWebhook] = useState(false)
  const WEBHOOK_URL = `${window.location.origin}/api/webhooks/zernio`
  const HMAC_SECRET = '••••••••••••••••••••••••'

  // Test message state
  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState('Hello! This is a test message from Whatsy 👋')
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Disconnect confirm
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, message, type }])
  }
  const removeToast = (id: number) => setToasts(t => t.filter(x => x.id !== id))

  useEffect(() => {
    fetch('/v1/whatsapp/connection', { headers: getAuthHeader() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setConn(data)
        else setConn({ status: 'disconnected', phoneNumber: '', displayName: '', verified: false, webhookHealthy: false, lastEventAt: '', apiTier: 'Tier 1' })
      })
      .catch(() => setConn({ status: 'disconnected', phoneNumber: '', displayName: '', verified: false, webhookHealthy: false, lastEventAt: '', apiTier: 'Tier 1' }))
      .finally(() => setLoadingConn(false))
  }, [])

  useEffect(() => {
    if (qrCountdown <= 0) return
    const t = setTimeout(() => setQrCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [qrCountdown])

  async function generateQR() {
    setQrLoading(true)
    setQrImage(null)
    try {
      const res = await fetch('/v1/whatsapp/connect/qr', { method: 'POST', headers: getAuthHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate QR')
      setQrImage(data.qrCode ?? null)
      setQrCountdown(20)
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Failed to generate QR', 'error')
    } finally {
      setQrLoading(false)
    }
  }

  async function connectCloud() {
    if (!phoneNumberId || !wabaId || !accessToken) { addToast('All fields are required', 'error'); return }
    setConnectLoading(true)
    try {
      const res = await fetch('/v1/whatsapp/connect/cloud-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ phoneNumberId, wabaId, accessToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Connection failed')
      addToast('Connected successfully!', 'success')
      setConn(c => c ? { ...c, status: 'connected' } : c)
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Connection failed', 'error')
    } finally {
      setConnectLoading(false)
    }
  }

  async function testWebhook() {
    setTestingWebhook(true)
    setWebhookTestResult(null)
    const t0 = Date.now()
    try {
      const res = await fetch('/v1/whatsapp/webhook/test', { method: 'POST', headers: getAuthHeader() })
      const ms = Date.now() - t0
      if (res.ok) setWebhookTestResult(`✓ ${res.status} OK — ${ms}ms`)
      else setWebhookTestResult(`✕ ${res.status} — ${ms}ms`)
    } catch {
      setWebhookTestResult('✕ Connection failed')
    } finally {
      setTestingWebhook(false)
    }
  }

  async function sendTestMessage() {
    if (!testPhone) { addToast('Enter a recipient phone number', 'error'); return }
    setSendingTest(true)
    setTestResult(null)
    try {
      const res = await fetch('/v1/messages/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ recipient_phone: testPhone, message: testMsg }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      setTestResult(`✓ Sent — ID: ${data.messageId ?? data.id ?? 'ok'}`)
    } catch (e: unknown) {
      setTestResult(`✕ ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setSendingTest(false)
    }
  }

  async function disconnect() {
    setDisconnecting(true)
    try {
      await fetch('/v1/whatsapp/disconnect', { method: 'POST', headers: getAuthHeader() })
      setConn(c => c ? { ...c, status: 'disconnected', phoneNumber: '', displayName: '' } : c)
      addToast('Disconnected successfully', 'success')
    } catch {
      addToast('Failed to disconnect', 'error')
    } finally {
      setDisconnecting(false)
      setShowDisconnectModal(false)
    }
  }

  const card = 'bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-5'
  const inputCls = 'w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884] focus:border-transparent'
  const labelCls = 'block text-xs font-medium text-gray-500 dark:text-[#8696a0] mb-1.5 uppercase tracking-wide'
  const primaryBtn = 'flex items-center justify-center gap-2 bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm'

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-[#0b141a] p-6">

      {/* Toast stack */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => removeToast(t.id)} />)}
      </div>

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-[#e9edef]">WhatsApp Connection</h1>
        <p className="text-gray-500 dark:text-[#8696a0] text-sm mt-0.5">Connect and manage your WhatsApp Business number via Zernio</p>
      </div>

      {/* ── 1. Status Card ── */}
      <div className={`${card} mb-5`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${conn?.status === 'connected' ? 'bg-emerald-100 dark:bg-emerald-900/30' : conn?.status === 'degraded' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
              <svg className={`w-6 h-6 ${conn?.status === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : conn?.status === 'degraded' ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <div>
              {loadingConn ? (
                <div className="flex items-center gap-2 text-gray-400 dark:text-[#8696a0]"><Spinner /> Loading…</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={conn?.status ?? 'disconnected'} />
                    {conn?.verified && (
                      <span title="Verified Business" className="text-blue-500">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                      </span>
                    )}
                  </div>
                  {conn?.phoneNumber ? (
                    <>
                      <p className="text-gray-900 dark:text-[#e9edef] font-semibold text-lg leading-tight">{conn.phoneNumber}</p>
                      <p className="text-gray-500 dark:text-[#8696a0] text-sm">{conn.displayName}</p>
                    </>
                  ) : (
                    <p className="text-gray-500 dark:text-[#8696a0] text-sm mt-1">No number connected</p>
                  )}
                </>
              )}
            </div>
          </div>

          {conn?.status !== 'disconnected' && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => fetch('/v1/whatsapp/reconnect', { method: 'POST', headers: getAuthHeader() }).then(() => addToast('Reconnected', 'success')).catch(() => addToast('Failed', 'error'))}
                className="px-3 py-1.5 text-sm rounded-lg border border-[#00a884] text-[#00a884] hover:bg-[#00a884]/10 font-medium transition-colors"
              >
                Reconnect
              </button>
              <button
                onClick={() => setShowDisconnectModal(true)}
                className="px-3 py-1.5 text-sm rounded-lg border border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Health sub-strip */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-[#222e35] flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${conn?.webhookHealthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-gray-500 dark:text-[#8696a0]">Webhook {conn?.webhookHealthy ? 'Healthy' : 'Failing'}</span>
          </div>
          {conn?.lastEventAt && (
            <span className="text-gray-400 dark:text-[#8696a0]">Last event: {new Date(conn.lastEventAt).toLocaleTimeString()}</span>
          )}
          {conn?.apiTier && (
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full text-xs font-medium">{conn.apiTier}</span>
          )}
        </div>
      </div>

      {/* ── 2. Connect Number ── */}
      {(conn?.status === 'disconnected' || !conn) && (
        <div className={`${card} mb-5`}>
          <h2 className="text-gray-900 dark:text-[#e9edef] font-semibold mb-4">Connect a Number</h2>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 dark:bg-[#182229] rounded-lg p-1 mb-5 w-fit">
            {(['qr', 'cloud'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab ? 'bg-white dark:bg-[#2a3942] text-gray-900 dark:text-[#e9edef] shadow-sm' : 'text-gray-500 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef]'}`}
              >
                {tab === 'qr' ? '📱 QR Code' : '☁️ Cloud API'}
              </button>
            ))}
          </div>

          {activeTab === 'qr' && (
            <div className="flex flex-col md:flex-row gap-6 items-start">
              {/* QR placeholder */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-48 h-48 rounded-xl bg-gray-100 dark:bg-[#182229] border-2 border-dashed border-gray-300 dark:border-[#374151] flex flex-col items-center justify-center">
                  {qrLoading ? (
                    <Spinner />
                  ) : qrImage ? (
                    <img src={qrImage} alt="QR Code" className="w-44 h-44 rounded-lg" />
                  ) : (
                    <>
                      <svg className="w-12 h-12 text-gray-300 dark:text-[#374151] mb-2" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 3h7v7H3V3zm2 2v3h3V5H5zm8-2h7v7h-7V3zm2 2v3h3V5h-3zM3 13h7v7H3v-7zm2 2v3h3v-3H5zm13 0h2v2h-2v-2zm-4-2h2v2h-2v-2zm4 4h2v2h-2v-2zm-4 0h2v4h-2v-4zm4 2h2v2h-2v-2z"/>
                      </svg>
                      <span className="text-gray-400 dark:text-[#8696a0] text-xs text-center px-2">Click below to generate</span>
                    </>
                  )}
                </div>
                {qrCountdown > 0 && <span className="text-xs text-gray-400 dark:text-[#8696a0]">Refreshes in {qrCountdown}s</span>}
                <button onClick={generateQR} disabled={qrLoading} className={primaryBtn}>
                  {qrLoading && <Spinner />} {qrImage ? 'Regenerate QR' : 'Generate QR Code'}
                </button>
                <p className="text-xs text-gray-400 dark:text-[#8696a0]">Scan with WhatsApp</p>
              </div>

              {/* Steps */}
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700 dark:text-[#e9edef] mb-3">How to connect:</p>
                <ol className="space-y-3">
                  {[
                    'Open WhatsApp on your phone',
                    'Go to Settings → Linked Devices',
                    'Tap "Link a Device"',
                    'Point your camera at the QR code',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-[#00a884]/15 text-[#00a884] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <span className="text-gray-600 dark:text-[#8696a0] text-sm">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {activeTab === 'cloud' && (
            <div className="max-w-md space-y-4">
              <div>
                <label className={labelCls}>Phone Number ID</label>
                <input value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="123456789012345" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>WhatsApp Business Account (WABA) ID</label>
                <input value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="987654321098765" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>System User Access Token</label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={accessToken}
                    onChange={e => setAccessToken(e.target.value)}
                    placeholder="EAAxxxx..."
                    className={`${inputCls} pr-16`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] px-2 py-1 rounded"
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <a
                href="https://business.facebook.com/settings/system-users"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[#00a884] text-sm hover:underline"
              >
                Get credentials from Meta Business Suite →
              </a>
              <button onClick={connectCloud} disabled={connectLoading} className={`${primaryBtn} w-full`}>
                {connectLoading && <Spinner />} Verify & Connect
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 3. Webhook Config ── */}
      <div className={`${card} mb-5`}>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-gray-900 dark:text-[#e9edef] font-semibold">Webhook Configuration</h2>
          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full text-xs font-medium">Required</span>
        </div>
        <p className="text-gray-500 dark:text-[#8696a0] text-sm mb-4">Configure this URL in your Meta App Dashboard under WhatsApp → Configuration.</p>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Callback URL</label>
            <div className="flex gap-2">
              <input readOnly value={WEBHOOK_URL} className={`${inputCls} flex-1 font-mono text-xs`} />
              <CopyButton text={WEBHOOK_URL} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Verify Token / HMAC Secret</label>
            <div className="flex gap-2">
              <input
                readOnly
                type={showSecret ? 'text' : 'password'}
                value={showSecret ? 'your-hmac-secret-here' : HMAC_SECRET}
                className={`${inputCls} flex-1 font-mono text-xs`}
              />
              <button
                onClick={() => setShowSecret(s => !s)}
                className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#374151] transition-colors"
              >
                {showSecret ? 'Hide' : 'Reveal'}
              </button>
              <CopyButton text="your-hmac-secret-here" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={testWebhook} disabled={testingWebhook} className={primaryBtn}>
              {testingWebhook ? <><Spinner /> Testing…</> : 'Test Webhook'}
            </button>
            {webhookTestResult && (
              <span className={`text-sm font-mono font-medium ${webhookTestResult.startsWith('✓') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {webhookTestResult}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. Test Message ── */}
      <div className={card}>
        <h2 className="text-gray-900 dark:text-[#e9edef] font-semibold mb-1">Send Test Message</h2>
        <p className="text-gray-500 dark:text-[#8696a0] text-sm mb-4">Verify your connection is working by sending a real WhatsApp message.</p>

        <div className="max-w-md space-y-4">
          <div>
            <label className={labelCls}>Recipient Phone (E.164 format)</label>
            <div className="flex gap-2">
              <span className="px-3 py-2.5 bg-gray-100 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] rounded-lg text-sm text-gray-500 dark:text-[#8696a0] font-mono shrink-0">+</span>
              <input
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="201234567890"
                className={`${inputCls} flex-1`}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Message</label>
            <textarea
              value={testMsg}
              onChange={e => setTestMsg(e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={sendTestMessage} disabled={sendingTest} className={primaryBtn}>
              {sendingTest ? <><Spinner /> Sending…</> : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  Send Test
                </>
              )}
            </button>
            {testResult && (
              <span className={`text-sm font-medium font-mono ${testResult.startsWith('✓') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {testResult}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Disconnect Confirm Modal ── */}
      {showDisconnectModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <h3 className="text-gray-900 dark:text-[#e9edef] font-semibold">Disconnect Number?</h3>
                <p className="text-gray-500 dark:text-[#8696a0] text-sm">This will stop all incoming messages.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDisconnectModal(false)} className="flex-1 py-2 border border-gray-200 dark:border-[#374151] rounded-lg text-sm text-gray-700 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors">
                Cancel
              </button>
              <button onClick={disconnect} disabled={disconnecting} className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                {disconnecting && <Spinner />} Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
