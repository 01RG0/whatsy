import { useEffect, useRef, useState } from 'react'
import { useSettingsStore, WorkspaceSettings } from '../store/useSettingsStore'
import AutoReplyPage from './AutoReplyPage'
import { isAdmin } from '../lib/auth'
import { useT } from '../i18n/translations'
import { useLanguageStore } from '../store/useLanguageStore'
import { useDarkModeStore } from '../store/useDarkModeStore'

// ─── Feature definitions ────────────────────────────────────────────────────

interface FeatureFlag {
  key: keyof WorkspaceSettings
  icon: string
  title: string
  description: string
  adminOnly?: boolean
}

const FEATURES: FeatureFlag[] = [
  {
    key: 'interactive_messages_enabled',
    icon: '⚡',
    title: 'Interactive Messages',
    description: 'Allow agents to send reply buttons and list messages to contacts. When off, the ⚡ button is hidden from the chat input.',
  },
  {
    key: 'auto_reply_enabled',
    icon: '🤖',
    title: 'Auto Replies',
    description: 'Automatically reply to inbound messages that match keyword rules.',
  },
  {
    key: 'canned_responses_enabled',
    icon: '📋',
    title: 'Canned Responses',
    description: 'Allow agents to insert pre-saved response templates.',
  },
  {
    key: 'typing_indicators_enabled',
    icon: '✍️',
    title: 'Typing Indicators',
    description: 'Show live typing status to agents when a colleague is composing a reply.',
  },
]

// ─── Toggle card ─────────────────────────────────────────────────────────────

function FeatureCard({ feature }: { feature: FeatureFlag }) {
  const { settings, update, saving } = useSettingsStore()
  const admin = isAdmin()
  const enabled = Boolean(settings[feature.key])

  const toggle = async () => {
    if (!admin || saving) return
    await update({ [feature.key]: !enabled })
  }

  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] shadow-sm">
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-2xl mt-0.5 shrink-0">{feature.icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800 dark:text-[#e9edef]">{feature.title}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 dark:bg-[#2a3942] dark:text-[#8696a0]'}`}>
              {enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-1 leading-relaxed">{feature.description}</p>
          {!admin && <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">Admin only</p>}
        </div>
      </div>
      {/* Toggle switch */}
      <button
        type="button"
        onClick={toggle}
        disabled={!admin || saving}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${feature.title}`}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
          enabled ? 'bg-[#00a884]' : 'bg-gray-300 dark:bg-[#2a3942]'
        } ${!admin ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
  )
}

// ─── Appearance section ───────────────────────────────────────────────────────

function AppearanceSection() {
  const t = useT()
  const { lang, setLang } = useLanguageStore()
  const { dark, toggle: toggleDark } = useDarkModeStore()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🌓</span>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-[#e9edef]">{dark ? t.nav_light_mode : t.nav_dark_mode}</p>
            <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-1">Toggle dark / light theme</p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleDark}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 ${dark ? 'bg-[#00a884]' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${dark ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🌐</span>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-[#e9edef]">Language</p>
            <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-1">English / العربية</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#2a3942] text-sm font-semibold text-gray-700 dark:text-[#e9edef] hover:bg-gray-100 dark:hover:bg-[#2a3942] transition-colors"
        >
          {lang === 'en' ? 'عربي' : 'EN'}
        </button>
      </div>
    </div>
  )
}

// ─── Integrations section ─────────────────────────────────────────────────────

function IntegrationsSection() {
  const { settings, update, saving } = useSettingsStore()
  const admin = isAdmin()

  // The value from the server — either "" (not set) or "sk_****...XXXX" (masked)
  const serverValue = (settings.zernio_api_key as string) ?? ''
  const isMasked = serverValue.includes('****')

  // Local draft state: null means "no change pending"
  const [draft, setDraft] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // When settings reload (e.g. after save), reset draft
  const prevServerRef = useRef(serverValue)
  useEffect(() => {
    if (prevServerRef.current !== serverValue) {
      prevServerRef.current = serverValue
      setDraft(null)
    }
  }, [serverValue])

  const handleChange = () => {
    // Clear masked placeholder and let the user type a new key
    setDraft('')
    setShowKey(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleSave = async () => {
    if (draft === null) return
    // Only send if it's a non-empty, non-masked value
    if (!draft || draft.includes('****')) return
    await update({ zernio_api_key: draft })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  // What to display in the input
  const displayValue = draft !== null ? draft : serverValue

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-xl bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] shadow-sm">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl mt-0.5 shrink-0">🔑</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-[#e9edef]">Zernio API Key</p>
            <p className="text-xs text-gray-500 dark:text-[#8696a0] mt-1 leading-relaxed">
              Required to connect your WhatsApp number. Get it from{' '}
              <a
                href="https://zernio.com"
                target="_blank"
                rel="noreferrer"
                className="text-[#00a884] hover:underline"
              >
                zernio.com
              </a>
            </p>
            {!admin && <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">Admin only</p>}
          </div>
        </div>

        {/* Input row */}
        <div className="flex items-center gap-2 mt-2">
          {/* If masked and no draft, show a read-only pill + Change button */}
          {isMasked && draft === null ? (
            <>
              <div className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#2a3942] border border-gray-200 dark:border-[#3d4e57] text-sm font-mono text-gray-400 dark:text-[#8696a0] truncate select-none">
                {serverValue}
              </div>
              <button
                type="button"
                onClick={handleChange}
                disabled={!admin}
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-[#2a3942] text-sm font-semibold text-gray-700 dark:text-[#e9edef] hover:bg-gray-100 dark:hover:bg-[#2a3942] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                Change
              </button>
            </>
          ) : (
            <>
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type={showKey ? 'text' : 'password'}
                  value={displayValue}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="sk_..."
                  disabled={!admin}
                  className="w-full px-3 py-2 pr-10 rounded-lg bg-gray-50 dark:bg-[#2a3942] border border-gray-200 dark:border-[#3d4e57] text-sm font-mono text-gray-800 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 focus:border-[#00a884] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#8696a0] hover:text-gray-600 dark:hover:text-[#e9edef] transition-colors"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 3C5 3 1.73 7.11 1.05 8.45a1 1 0 000 1.1C1.73 10.89 5 15 10 15s8.27-4.11 8.95-5.45a1 1 0 000-1.1C18.27 7.11 15 3 10 3zm0 10a4 4 0 110-8 4 4 0 010 8zm0-6a2 2 0 100 4 2 2 0 000-4z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10a10.057 10.057 0 00-9.542-7 9.958 9.958 0 00-4.512 1.074L3.707 2.293zM7.19 5.777a7.01 7.01 0 015.377 1.288L11.23 8.407A4 4 0 007.19 5.777zm-3.47 2.82A10.049 10.049 0 001.458 10a10.057 10.057 0 009.542 7c1.33 0 2.604-.254 3.772-.713l-1.505-1.506A7 7 0 014.5 10c0-.475.051-.937.147-1.383L3.72 8.597zm6.718 6.718l-1.504-1.503A4 4 0 017.19 14.223L5.836 12.87A7.01 7.01 0 0010.438 15.515z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={!admin || saving || !draft || draft.includes('****')}
                className="px-3 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f72] text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
              </button>

              {isMasked && draft !== null && (
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="px-2 py-2 rounded-lg border border-gray-200 dark:border-[#2a3942] text-xs text-gray-500 dark:text-[#8696a0] hover:bg-gray-100 dark:hover:bg-[#2a3942] transition-colors shrink-0"
                  title="Cancel"
                >
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'features' | 'automation' | 'appearance' | 'integrations'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('features')
  const { fetch, loading } = useSettingsStore()

  useEffect(() => {
    fetch()
  }, [fetch])

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'features', label: 'Features', icon: '⚙️' },
    { id: 'automation', label: 'Automation', icon: '🤖' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    { id: 'integrations', label: 'Integrations', icon: '🔑' },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f0f2f5] dark:bg-[#0b1014] overflow-hidden">
      {/* Header */}
      <div className="bg-white dark:bg-[#111b21] border-b border-gray-200 dark:border-[#222e35] px-6 py-4 shrink-0">
        <h1 className="text-lg font-bold text-gray-900 dark:text-[#e9edef]">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-[#8696a0] mt-0.5">Manage workspace features and preferences</p>
      </div>

      {/* Tab bar */}
      <div className="bg-white dark:bg-[#111b21] border-b border-gray-200 dark:border-[#222e35] px-6 flex gap-1 shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-[#00a884] text-[#00a884]'
                : 'border-transparent text-gray-500 dark:text-[#8696a0] hover:text-gray-700 dark:hover:text-[#e9edef]'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'features' && (
          <div className="max-w-2xl mx-auto p-6 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400 dark:text-[#8696a0] text-sm">Loading settings…</div>
            ) : (
              FEATURES.map(f => <FeatureCard key={f.key} feature={f} />)
            )}
          </div>
        )}

        {tab === 'automation' && (
          <div className="h-full">
            <AutoReplyPage />
          </div>
        )}

        {tab === 'appearance' && (
          <div className="max-w-2xl mx-auto p-6">
            <AppearanceSection />
          </div>
        )}

        {tab === 'integrations' && (
          <div className="max-w-2xl mx-auto p-6">
            <IntegrationsSection />
          </div>
        )}
      </div>
    </div>
  )
}
