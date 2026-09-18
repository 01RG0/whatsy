import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../api/inbox'

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('whatsy_jwt')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface SenderRow {
  accountId: string
  phoneNumber: string
  displayName: string
  type: 'sandbox' | 'live'
  status: 'live' | 'disconnected' | 'pending'
  nameReview?: string
  businessVerification?: string
  callingEnabled?: boolean
}

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin w-${size} h-${size}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ── Wizard Modal ─────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4
type SetupMethod = 'new' | 'own' | null
type PlacementMethod = 'coexistence' | 'api' | null

function ConnectWizard({
  onClose,
  onConnected,
}: {
  onClose: () => void
  onConnected: () => void
}) {
  const [step, setStep] = useState<WizardStep>(1)
  const [setupMethod, setSetupMethod] = useState<SetupMethod>(null)
  const [placementMethod, setPlacementMethod] = useState<PlacementMethod>(null)
  const [coexLearnMore, setCoexLearnMore] = useState(false)
  const [apiLearnMore, setApiLearnMore] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [launching, setLaunching] = useState(false)

  // credentials tab (step 4 alt)
  const [showCredentials, setShowCredentials] = useState(false)
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [pin, setPin] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connectLoading, setConnectLoading] = useState(false)
  const [error, setError] = useState('')

  async function launchSignup() {
    setLaunching(true)
    setError('')
    try {
      const onboarding = placementMethod === 'coexistence' ? 'business_app' : 'api'
      const redirectUrl = encodeURIComponent(window.location.href)
      const res = await fetch(
        `${API_BASE}/v1/whatsapp/connection/qr?redirectUrl=${redirectUrl}&onboarding=${onboarding}`,
        { headers: getAuthHeader() }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to get signup URL')
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'noopener,noreferrer')
        onClose()
        // Poll status after a short delay to catch the new connection
        setTimeout(() => onConnected(), 4000)
        setTimeout(() => onConnected(), 10000)
        setTimeout(() => onConnected(), 20000)
      } else {
        throw new Error('No auth URL returned')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start signup')
    } finally {
      setLaunching(false)
    }
  }

  async function connectCredentials() {
    if (!phoneNumberId || !wabaId || !accessToken) {
      setError('Phone Number ID, WABA ID and Access Token are required')
      return
    }
    setConnectLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/whatsapp/connection/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ phoneNumberId, wabaId, accessToken, pin: pin || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Connection failed')
      onConnected()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setConnectLoading(false)
    }
  }

  const inputCls =
    'w-full bg-gray-50 dark:bg-[#2a3942] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#25D366] focus:border-transparent'

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-[#1f2c34] rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden border border-gray-100 dark:border-[#2a3942]">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-0">
          {step > 1 && !showCredentials && (
            <button
              onClick={() => { setStep(s => (s - 1) as WizardStep); setError('') }}
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-[#2a3942] text-gray-500 dark:text-[#8696a0] mr-1"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          )}
          <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-gray-900 dark:text-[#e9edef] font-semibold text-base leading-tight">Connect WhatsApp</h2>
            <p className="text-gray-400 dark:text-[#8696a0] text-xs">
              {step === 1 && 'Choose how to set up your number'}
              {step === 2 && 'Where is your number now?'}
              {step === 3 && 'Watch before you continue'}
              {showCredentials && 'Enter your Meta credentials'}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto p-1 rounded-full hover:bg-gray-100 dark:hover:bg-[#2a3942] text-gray-400 dark:text-[#8696a0]">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Step 1: Setup method ── */}
        {step === 1 && !showCredentials && (
          <div className="p-6 space-y-3">
            <button
              onClick={() => { setSetupMethod('new'); setPlacementMethod('api'); setStep(3) }}
              className="w-full flex items-start gap-4 border border-gray-200 dark:border-[#2a3942] rounded-xl p-4 text-left hover:border-gray-300 dark:hover:border-[#374151] hover:bg-gray-50 dark:hover:bg-[#2a3942] transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-[#2a3942] group-hover:bg-gray-200 dark:group-hover:bg-[#374151] flex items-center justify-center shrink-0 text-gray-500 dark:text-[#8696a0] font-bold text-lg transition-colors">+</div>
              <div>
                <p className="text-gray-900 dark:text-[#e9edef] font-medium text-sm">Get a number</p>
                <p className="text-gray-400 dark:text-[#8696a0] text-xs mt-0.5">From $3/mo. Pick a country, we handle setup.</p>
              </div>
            </button>

            <button
              onClick={() => { setSetupMethod('own'); setStep(2) }}
              className="w-full flex items-start gap-4 border border-gray-200 dark:border-[#2a3942] rounded-xl p-4 text-left hover:border-gray-300 dark:hover:border-[#374151] hover:bg-gray-50 dark:hover:bg-[#2a3942] transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-[#2a3942] group-hover:bg-gray-200 dark:group-hover:bg-[#374151] flex items-center justify-center shrink-0 text-gray-500 dark:text-[#8696a0] font-bold text-lg transition-colors">#</div>
              <div>
                <p className="text-gray-900 dark:text-[#e9edef] font-medium text-sm">Use my own number</p>
                <p className="text-gray-400 dark:text-[#8696a0] text-xs mt-0.5">Bring your existing phone number. Requires verification during setup.</p>
              </div>
            </button>
          </div>
        )}

        {/* ── Step 2: Where is the number ── */}
        {step === 2 && !showCredentials && (
          <div className="p-6 space-y-3">
            {/* Coexistence option */}
            <button
              onClick={() => { setPlacementMethod('coexistence'); setStep(3) }}
              className="w-full flex items-start gap-4 border border-gray-200 dark:border-[#2a3942] rounded-xl p-4 text-left hover:border-gray-300 dark:hover:border-[#374151] hover:bg-gray-50 dark:hover:bg-[#2a3942] transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-[#2a3942] group-hover:bg-gray-200 dark:group-hover:bg-[#374151] flex items-center justify-center shrink-0 text-gray-500 dark:text-[#8696a0] transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><path d="M12 18h.01"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-gray-900 dark:text-[#e9edef] font-medium text-sm">I chat from the WhatsApp Business app</p>
                  <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-[#8696a0] text-[10px] rounded font-medium">Coexistence</span>
                </div>
                <p className="text-gray-400 dark:text-[#8696a0] text-xs">Keep the app on your phone working exactly as it does. We connect alongside it, so nothing changes for you or your customers.</p>
                <button
                  onClick={e => { e.stopPropagation(); setCoexLearnMore(s => !s) }}
                  className="text-xs text-gray-400 dark:text-[#8696a0] hover:text-gray-600 dark:hover:text-[#e9edef] mt-1.5 flex items-center gap-1"
                >
                  Learn more
                  <svg className={`w-3 h-3 transition-transform ${coexLearnMore ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                {coexLearnMore && (
                  <p className="text-xs text-gray-400 dark:text-[#8696a0] mt-2 border-t border-gray-100 dark:border-[#2a3942] pt-2">
                    Coexistence keeps your WhatsApp Business app active while also connecting it to the Cloud API. Some API features are limited: throughput is capped at 20 msg/s, Groups API and Calling are unavailable.
                  </p>
                )}
              </div>
            </button>

            {/* Cloud API option */}
            <button
              onClick={() => { setPlacementMethod('api'); setStep(3) }}
              className="w-full flex items-start gap-4 border border-gray-200 dark:border-[#2a3942] rounded-xl p-4 text-left hover:border-gray-300 dark:hover:border-[#374151] hover:bg-gray-50 dark:hover:bg-[#2a3942] transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-[#2a3942] group-hover:bg-gray-200 dark:group-hover:bg-[#374151] flex items-center justify-center shrink-0 text-gray-500 dark:text-[#8696a0] transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-gray-900 dark:text-[#e9edef] font-medium text-sm mb-0.5">It's with another provider or on the API</p>
                <p className="text-gray-400 dark:text-[#8696a0] text-xs">Already on the WhatsApp Business API (Twilio, 360dialog, your own Meta setup…). We take over as the provider; your number and templates come with you.</p>
                <button
                  onClick={e => { e.stopPropagation(); setApiLearnMore(s => !s) }}
                  className="text-xs text-gray-400 dark:text-[#8696a0] hover:text-gray-600 dark:hover:text-[#e9edef] mt-1.5 flex items-center gap-1"
                >
                  Learn more
                  <svg className={`w-3 h-3 transition-transform ${apiLearnMore ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                {apiLearnMore && (
                  <p className="text-xs text-gray-400 dark:text-[#8696a0] mt-2 border-t border-gray-100 dark:border-[#2a3942] pt-2">
                    Full Cloud API: unlimited throughput, Groups API, Calling, all features. Meta's Embedded Signup handles the migration — your templates and history stay intact.
                  </p>
                )}
              </div>
            </button>

            <p className="text-xs text-gray-400 dark:text-[#8696a0] text-center">Using the regular WhatsApp app? Switch the number to the free WhatsApp Business app first, then pick the first option.</p>
          </div>
        )}

        {/* ── Step 3: Watch & confirm ── */}
        {step === 3 && !showCredentials && (
          <div className="p-6 space-y-4">
            <p className="text-gray-600 dark:text-[#aebac1] text-sm">
              {placementMethod === 'coexistence'
                ? "This 2-minute video walks you through exactly what Meta's popup will ask: logging in with Facebook, picking the number from your WhatsApp Business app, and scanning a QR code with your phone. Watch it once and the setup will feel familiar."
                : setupMethod === 'new'
                ? "You'll be taken to Zernio to pick a number for your country. After purchase, Meta's setup runs automatically — no QR scan needed."
                : "This 2-minute guide walks you through Meta's Embedded Signup: logging in with Facebook, selecting your WABA and phone number. The whole process takes about 3 minutes."}
            </p>

            {/* Info card instead of video */}
            <div className="bg-[#111b21] dark:bg-[#0b141a] rounded-xl p-6 text-white relative overflow-hidden min-h-[120px] flex items-center justify-center border border-[#2a3942]">
              <div className="absolute inset-0 opacity-10 bg-gradient-to-br from-[#25D366] to-blue-500" />
              <div className="text-center relative z-10">
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-2">
                  <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </div>
                <p className="text-sm text-white/70">Seamlessly connect your account</p>
                <p className="text-xs text-white/50 mt-1">Send messages at scale, manage conversations automatically, reduce costs</p>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${confirmed ? 'bg-[#25D366] border-[#25D366]' : 'border-gray-300 dark:border-[#8696a0]'}`}
                onClick={() => setConfirmed(c => !c)}>
                {confirmed && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M20 6L9 17l-5-5"/></svg>}
              </div>
              <span className="text-gray-700 dark:text-[#aebac1] text-sm">I've watched the video and understand how the setup works.</span>
            </label>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="space-y-2 pt-1">
              <button
                onClick={launchSignup}
                disabled={!confirmed || launching}
                className="w-full flex items-center justify-center gap-2 bg-[#E53935] hover:bg-[#C62828] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors text-sm"
              >
                {launching ? <><Spinner /> Opening Meta…</> : 'Continue to WhatsApp setup'}
              </button>
              <button
                onClick={() => { setShowCredentials(true); setConfirmed(false); setError('') }}
                className="w-full py-2.5 border border-gray-200 dark:border-[#2a3942] rounded-xl text-gray-500 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-[#2a3942] text-sm transition-colors"
              >
                I want to be guided step by step
              </button>
            </div>
          </div>
        )}

        {/* ── Credentials form (alternative to signup) ── */}
        {showCredentials && (
          <div className="p-6 space-y-4">
            <p className="text-gray-500 dark:text-[#8696a0] text-sm">Enter your Meta System User credentials. Get them from <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer" className="text-[#25D366] hover:underline">Meta Business Suite</a>.</p>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-[#8696a0] mb-1.5 uppercase tracking-wide">Phone Number ID</label>
              <input value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="1875844705851813" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-[#8696a0] mb-1.5 uppercase tracking-wide">WABA ID</label>
              <input value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="317766992490131" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-[#8696a0] mb-1.5 uppercase tracking-wide">System User Access Token</label>
              <div className="relative">
                <input type={showToken ? 'text' : 'password'} value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAABsbCS..." className={`${inputCls} pr-16`} />
                <button type="button" onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef] px-2 py-1 rounded">
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-[#8696a0] mb-1.5 uppercase tracking-wide">Two-Step PIN <span className="normal-case font-normal text-gray-400 dark:text-[#8696a0]">(optional)</span></label>
              <input value={pin} onChange={e => setPin(e.target.value)} placeholder="6-digit PIN" maxLength={6} className={inputCls} />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowCredentials(false); setError('') }} className="flex-1 py-2.5 border border-gray-200 dark:border-[#2a3942] rounded-xl text-gray-500 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-[#2a3942] text-sm transition-colors">Back</button>
              <button onClick={connectCredentials} disabled={connectLoading} className="flex-1 flex items-center justify-center gap-2 bg-[#E53935] hover:bg-[#C62828] disabled:opacity-50 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
                {connectLoading && <Spinner />} Verify & Connect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#374151] transition-colors font-medium">
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

interface SyncState {
  phase: 'idle' | 'counting' | 'syncing' | 'done' | 'error'
  synced: number
  total: number
  percent: number
  message: string
}

export default function WhatsAppConnectionPage() {
  const [senders, setSenders] = useState<SenderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [showDisconnectId, setShowDisconnectId] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [sync, setSync] = useState<SyncState>({ phase: 'idle', synced: 0, total: 0, percent: 0, message: '' })
  const syncAbortRef = useRef<AbortController | null>(null)

  // Webhook/test panel (shown when a sender exists)
  const [showSecret, setShowSecret] = useState(false)
  const [webhookTestResult, setWebhookTestResult] = useState<string | null>(null)
  const [testingWebhook, setTestingWebhook] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState('Hello! This is a test message from Whatsy 👋')
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const toastId = useRef(0)
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([])

  const WEBHOOK_URL = `${window.location.origin.replace(':5173', ':8080')}/api/webhooks/zernio`

  const addToast = (message: string, type: 'success' | 'error') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  async function loadSenders() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/v1/whatsapp/connection/status`, { headers: getAuthHeader() })
      const data = await res.json()
      if (res.ok && data.status) {
        if (data.status === 'disconnected') {
          setSenders([])
        } else {
          setSenders([{
            accountId: data.accountId ?? '',
            phoneNumber: data.phoneNumber ?? '',
            displayName: data.displayName ?? (data.isSandbox ? 'Shared test number' : ''),
            type: data.isSandbox ? 'sandbox' : 'live',
            status: 'live',
          }])
        }
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const SYNC_KEY = 'whatsy_last_sync'
  const SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

  useEffect(() => { loadSenders() }, [])

  // Background incremental sync on page load — silent, fast, no progress bar
  useEffect(() => {
    if (senders.length === 0) return
    const lastSync = localStorage.getItem(SYNC_KEY)
    const since = lastSync ? new Date(lastSync) : null
    const age = since ? Date.now() - since.getTime() : Infinity
    if (age < SYNC_INTERVAL_MS) return // synced recently, skip
    backgroundSync(since ?? undefined)
  }, [senders.length])

  async function backgroundSync(since?: Date) {
    try {
      const url = since
        ? `${API_BASE}/v1/sync?since=${encodeURIComponent(since.toISOString())}`
        : `${API_BASE}/v1/sync`
      const res = await fetch(url, { method: 'POST', headers: getAuthHeader() })
      if (!res.ok) return
      const data = await res.json()
      if (data.syncedAt) localStorage.setItem(SYNC_KEY, data.syncedAt)
    } catch { /* silent */ }
  }

  async function startSync() {
    if (sync.phase === 'syncing' || sync.phase === 'counting') return
    syncAbortRef.current?.abort()
    const ctrl = new AbortController()
    syncAbortRef.current = ctrl
    setSync({ phase: 'counting', synced: 0, total: 0, percent: 0, message: 'Connecting to Zernio…' })
    try {
      const res = await fetch(`${API_BASE}/v1/sync/stream`, {
        headers: getAuthHeader(),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error('Sync failed')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.phase === 'done') localStorage.setItem(SYNC_KEY, new Date().toISOString())
            setSync({ phase: ev.phase, synced: ev.synced ?? 0, total: ev.total ?? 0, percent: ev.percent ?? 0, message: ev.message ?? '' })
          } catch { /* ignore */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') return
      setSync(s => ({ ...s, phase: 'error', message: e instanceof Error ? e.message : 'Sync failed' }))
    }
  }

  async function disconnect(accountId: string) {
    setDisconnecting(true)
    try {
      const res = await fetch(`${API_BASE}/v1/whatsapp/connection/disconnect`, { method: 'POST', headers: getAuthHeader() })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Disconnect failed [${res.status}]`)
      }
      setSenders(s => s.filter(r => r.accountId !== accountId))
      addToast('Disconnected successfully', 'success')
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Failed to disconnect', 'error')
    } finally {
      setDisconnecting(false)
      setShowDisconnectId(null)
    }
  }

  async function testWebhook() {
    setTestingWebhook(true)
    setWebhookTestResult(null)
    const t0 = Date.now()
    try {
      const res = await fetch(`${API_BASE}/v1/whatsapp/connection/status`, { headers: getAuthHeader() })
      const ms = Date.now() - t0
      setWebhookTestResult(res.ok ? `✓ ${res.status} OK — ${ms}ms` : `✕ ${res.status} — ${ms}ms`)
    } catch { setWebhookTestResult('✕ Connection failed') }
    finally { setTestingWebhook(false) }
  }

  async function sendTestMessage() {
    if (!testPhone) { addToast('Enter a recipient phone number', 'error'); return }
    setSendingTest(true)
    setTestResult(null)
    try {
      const res = await fetch(`${API_BASE}/v1/whatsapp/connection/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ to: testPhone, message: testMsg }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      setTestResult(`✓ Sent — ID: ${data.messageId ?? data.conversationId ?? 'ok'}`)
    } catch (e: unknown) {
      setTestResult(`✕ ${e instanceof Error ? e.message : 'Failed'}`)
    } finally { setSendingTest(false) }
  }

  const inputCls = 'w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884] focus:border-transparent'
  const labelCls = 'block text-xs font-medium text-gray-500 dark:text-[#8696a0] mb-1.5 uppercase tracking-wide'
  const primaryBtn = 'flex items-center justify-center gap-2 bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm'

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-[#0b141a]">

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${t.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'} text-white`}>
            {t.type === 'success' ? '✓' : '✕'} {t.message}
          </div>
        ))}
      </div>

      {/* Wizard */}
      {showWizard && (
        <ConnectWizard
          onClose={() => setShowWizard(false)}
          onConnected={() => { loadSenders(); addToast('Connected successfully!', 'success') }}
        />
      )}

      {/* ── Page header ── */}
      <div className="px-6 pt-6 pb-0 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-[#e9edef]">WhatsApp</h1>
          <p className="text-gray-400 dark:text-[#8696a0] text-sm mt-0.5">live senders</p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 bg-[#E53935] hover:bg-[#C62828] text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Connect WhatsApp
        </button>
      </div>

      {/* ── Senders table ── */}
      <div className="px-6 mt-5">
        {/* Search + filters bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input placeholder="Search senders..." className="w-full pl-9 pr-3 py-2 bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-lg text-sm text-gray-700 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] outline-none focus:ring-2 focus:ring-[#00a884]" />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-lg text-sm text-gray-600 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-[#182229] transition-colors">
            All types
            <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-lg text-sm text-gray-600 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-[#182229] transition-colors">
            Any status
            <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr] gap-4 px-5 py-3 border-b border-gray-100 dark:border-[#222e35] text-xs font-medium text-gray-500 dark:text-[#8696a0]">
            <span>Sender</span>
            <span>Number</span>
            <span>Type</span>
            <span>Status</span>
            <span>Actions</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 dark:text-[#8696a0] gap-2">
              <Spinner /> Loading…
            </div>
          ) : senders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-[#182229] flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <p className="text-gray-600 dark:text-[#e9edef] font-medium text-sm">No senders connected</p>
              <p className="text-gray-400 dark:text-[#8696a0] text-xs mt-1 mb-4">Connect a WhatsApp number to start sending messages</p>
              <button onClick={() => setShowWizard(true)} className="flex items-center gap-2 bg-[#E53935] hover:bg-[#C62828] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                Connect WhatsApp
              </button>
            </div>
          ) : (
            senders.map(sender => (
              <div key={sender.accountId} className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr] gap-4 items-center px-5 py-4 border-b border-gray-50 dark:border-[#182229] last:border-0 hover:bg-gray-50/50 dark:hover:bg-[#182229]/50 transition-colors">
                {/* Sender */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#25D366]/10 border border-[#25D366]/20 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-gray-900 dark:text-[#e9edef] font-medium text-sm truncate">{sender.displayName || 'Sandbox'}</p>
                    <p className="text-gray-400 dark:text-[#8696a0] text-xs truncate">{sender.type === 'sandbox' ? 'Shared test number' : 'Connected'}</p>
                  </div>
                </div>

                {/* Number */}
                <span className="text-gray-700 dark:text-[#e9edef] text-sm font-mono">{sender.phoneNumber}</span>

                {/* Type */}
                <span>
                  {sender.type === 'sandbox' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-[#182229] text-gray-600 dark:text-[#8696a0] text-xs rounded-full font-medium">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>
                      Sandbox
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs rounded-full font-medium">Live</span>
                  )}
                </span>

                {/* Status */}
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${sender.status === 'live' ? 'bg-emerald-500' : 'bg-red-400'}`} />
                  <span className={`text-sm font-medium ${sender.status === 'live' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                    {sender.status === 'live' ? 'Live' : 'Disconnected'}
                  </span>
                </span>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {sender.type === 'sandbox' ? (
                    <button
                      onClick={() => setTestPhone(sender.phoneNumber)}
                      className="text-xs text-[#00a884] hover:underline whitespace-nowrap"
                    >
                      Test from Phone numbers
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowDisconnectId(sender.accountId)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Sync bar ── */}
      {senders.length > 0 && (
        <div className="px-6 mt-4">
          <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[#00a884]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                </svg>
                <span className="text-sm font-medium text-gray-900 dark:text-[#e9edef]">Conversation Sync</span>
                {sync.phase === 'done' && (
                  <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-xs rounded-full font-medium">
                    {sync.synced} synced
                  </span>
                )}
                {sync.phase === 'error' && (
                  <span className="px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-500 text-xs rounded-full font-medium">Failed</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(sync.phase === 'syncing' || sync.phase === 'counting') && (
                  <span className="text-xs text-gray-400 dark:text-[#8696a0] tabular-nums">
                    {sync.synced}/{sync.total > 0 ? sync.total : '?'} — {sync.percent}%
                  </span>
                )}
                <button
                  onClick={startSync}
                  disabled={sync.phase === 'syncing' || sync.phase === 'counting'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#374151] disabled:opacity-50 transition-colors"
                >
                  {(sync.phase === 'syncing' || sync.phase === 'counting') ? (
                    <><Spinner size={3} /> Syncing…</>
                  ) : (
                    <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>Re-sync</>
                  )}
                </button>
              </div>
            </div>

            {/* Progress bar */}
            {(sync.phase === 'syncing' || sync.phase === 'counting' || sync.phase === 'done') && (
              <div className="w-full bg-gray-100 dark:bg-[#2a3942] rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${sync.phase === 'done' ? 'bg-emerald-500' : 'bg-[#00a884]'}`}
                  style={{ width: `${sync.phase === 'counting' ? 5 : sync.percent}%` }}
                />
              </div>
            )}

            {sync.message && sync.phase !== 'idle' && (
              <p className={`text-xs mt-1.5 ${sync.phase === 'error' ? 'text-red-500' : 'text-gray-400 dark:text-[#8696a0]'}`}>
                {sync.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Webhook & Test ── */}
      {senders.length > 0 && (
        <div className="px-6 mt-6 pb-6 grid md:grid-cols-2 gap-5">
          {/* Webhook card */}
          <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-5">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-gray-900 dark:text-[#e9edef] font-semibold text-sm">Webhook Configuration</h2>
              <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-semibold uppercase tracking-wide">Required</span>
            </div>
            <p className="text-gray-400 dark:text-[#8696a0] text-xs mb-4">Configure in Meta App Dashboard → WhatsApp → Configuration.</p>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Callback URL</label>
                <div className="flex gap-2"><input readOnly value={WEBHOOK_URL} className={`${inputCls} flex-1 font-mono text-xs`} /><CopyButton text={WEBHOOK_URL} /></div>
              </div>
              <div>
                <label className={labelCls}>HMAC Secret</label>
                <div className="flex gap-2">
                  <input readOnly type={showSecret ? 'text' : 'password'} value={showSecret ? 'your-hmac-secret-here' : '••••••••••••••••••••••••'} className={`${inputCls} flex-1 font-mono text-xs`} />
                  <button onClick={() => setShowSecret(s => !s)} className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-[#2a3942] text-gray-600 dark:text-[#8696a0] hover:bg-gray-200 dark:hover:bg-[#374151] transition-colors">{showSecret ? 'Hide' : 'Reveal'}</button>
                  <CopyButton text="your-hmac-secret-here" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={testWebhook} disabled={testingWebhook} className={primaryBtn}>
                  {testingWebhook ? <><Spinner /> Testing…</> : 'Test Webhook'}
                </button>
                {webhookTestResult && (
                  <span className={`text-sm font-mono font-medium ${webhookTestResult.startsWith('✓') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>{webhookTestResult}</span>
                )}
              </div>
            </div>
          </div>

          {/* Test message card */}
          <div className="bg-white dark:bg-[#111b21] rounded-xl border border-gray-200 dark:border-[#222e35] p-5">
            <h2 className="text-gray-900 dark:text-[#e9edef] font-semibold text-sm mb-1">Send Test Message</h2>
            <p className="text-gray-400 dark:text-[#8696a0] text-xs mb-4">Verify your connection by sending a real WhatsApp message.</p>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Recipient Phone (E.164)</label>
                <div className="flex gap-2">
                  <span className="px-3 py-2.5 bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] rounded-lg text-sm text-gray-500 dark:text-[#8696a0] font-mono shrink-0">+</span>
                  <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="201234567890" className={`${inputCls} flex-1`} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Message</label>
                <textarea value={testMsg} onChange={e => setTestMsg(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={sendTestMessage} disabled={sendingTest} className={primaryBtn}>
                  {sendingTest ? <><Spinner /> Sending…</> : <><svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>Send Test</>}
                </button>
                {testResult && (
                  <span className={`text-sm font-mono font-medium ${testResult.startsWith('✓') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>{testResult}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect confirm modal */}
      {showDisconnectId && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <h3 className="text-gray-900 dark:text-[#e9edef] font-semibold">Disconnect Number?</h3>
                <p className="text-gray-500 dark:text-[#8696a0] text-sm">This will stop all incoming messages.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDisconnectId(null)} className="flex-1 py-2 border border-gray-200 dark:border-[#374151] rounded-lg text-sm text-gray-700 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-[#202c33] transition-colors">Cancel</button>
              <button onClick={() => disconnect(showDisconnectId)} disabled={disconnecting} className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                {disconnecting && <Spinner />} Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
