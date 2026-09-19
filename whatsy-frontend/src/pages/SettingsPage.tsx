import { useEffect, useState } from 'react'
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

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'features' | 'automation' | 'appearance'

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
      </div>
    </div>
  )
}
