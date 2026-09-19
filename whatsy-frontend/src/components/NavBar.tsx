import { useState, useEffect } from 'react'
import { navigate } from '../App'
import { getCurrentAgent } from '../lib/auth'
import ChangePasswordModal from './ChangePasswordModal'
import { useInboxStore } from '../store/useInboxStore'
import { useLanguageStore } from '../store/useLanguageStore'
import { useT } from '../i18n/translations'


const navItems = [
  {
    href: '/',
    labelKey: 'nav_inbox' as const,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: '/students',
    labelKey: 'nav_students' as const,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/broadcasts',
    labelKey: 'nav_broadcasts' as const,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        <path d="M14.05 2a9 9 0 0 1 8 7.94" />
        <path d="M14.05 6A5 5 0 0 1 18 10" />
      </svg>
    ),
  },
  {
    href: '/team',
    labelKey: 'nav_team' as const,
    adminOnly: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4.354a4 4 0 1 1 0 5.292" />
        <path d="M15 21H3v-1a6 6 0 0 1 12 0v1z" />
        <path d="M21 21v-1a6 6 0 0 0-4.343-5.747" />
        <circle cx="9" cy="7" r="4" />
      </svg>
    ),
  },
  {
    href: '/connection',
    labelKey: 'nav_connection' as const,
    adminOnly: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.56 2.9A7 7 0 0 1 19 9v4" />
        <path d="M4.15 6.24A7 7 0 0 0 5 9v4" />
        <path d="M12 13a3 3 0 0 0 3-3V9a3 3 0 0 0-6 0v1a3 3 0 0 0 3 3z" />
        <path d="M12 13v8" />
        <path d="M8 21h8" />
      </svg>
    ),
  },
  {
    href: '/settings',
    labelKey: 'nav_settings' as const,
    adminOnly: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
].filter((item) => item.href !== '/broadcasts')

function LanguageToggleButton() {
  const { lang, setLang } = useLanguageStore()
  return (
    <button
      onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
      title={lang === 'en' ? 'العربية' : 'English'}
      className="px-2 py-1 rounded-lg text-xs font-semibold text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#e9edef]/60 dark:hover:bg-[#2a3942] transition-colors tracking-wide"
    >
      {lang === 'en' ? 'عربي' : 'EN'}
    </button>
  )
}

function NavItem({ href, icon, label, path, badge }: { href: string; icon: React.ReactNode; label: string; path: string; badge?: number }) {
  const active = path === href || (href !== '/' && path.startsWith(href))
  return (
    <button
      onClick={() => navigate(href)}
      title={label}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-all text-sm font-medium
        ${active
          ? 'bg-[#00a884]/15 text-[#00a884]'
          : 'text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#e9edef]/60 dark:hover:bg-[#2a3942]'
        }`}
    >
      <span className="relative shrink-0">
        {icon}
        {badge != null && badge > 0 && (
          <span className="absolute -top-1.5 end-[-6px] min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="hidden md:block">{label}</span>
    </button>
  )
}

function DarkModeButton() {
  const t = useT()
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('whatsy_dark')
    return saved ? saved === 'true' : true
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('whatsy_dark', String(dark))
  }, [dark])

  return (
    <button
      onClick={() => setDark(d => !d)}
      title={dark ? t.nav_light_mode : t.nav_dark_mode}
      className="p-2 rounded-lg text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] hover:bg-[#e9edef]/60 dark:hover:bg-[#2a3942] transition-colors"
    >
      {dark ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
        </svg>
      )}
    </button>
  )
}

function RoleBadge({ role }: { role: string }) {
  const t = useT()
  const roleLabel = role === 'admin' ? t.role_admin : role === 'viewer' ? t.role_viewer : t.role_agent
  const isAdm = role === 'admin'
  const isVwr = role === 'viewer'
  const colorClasses = isAdm
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700'
    : isVwr
    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 dark:border-blue-700'
    : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300 dark:border-green-700'

  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded border ${colorClasses}`}>
      {roleLabel}
    </span>
  )
}

export default function NavBar({ path }: { path: string }) {
  const t = useT()
  const [agent, setAgent] = useState(() => getCurrentAgent())
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const userIsAdmin = agent?.role === 'admin'
  const initials = agent?.name ? agent.name.slice(0, 2).toUpperCase() : '?'
  const visibleNavItems = navItems.filter(item => !item.adminOnly || userIsAdmin)
  const totalUnread = useInboxStore(s => s.totalUnread)
  const activeConversationId = useInboxStore(s => s.activeConversationId)
  const isMobileChatOpen = useInboxStore(s => s.isMobileChatOpen)

  useEffect(() => {
    const syncAgent = () => setAgent(getCurrentAgent())
    window.addEventListener('whatsy_agent_updated', syncAgent)
    return () => window.removeEventListener('whatsy_agent_updated', syncAgent)
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('whatsy_jwt')
    localStorage.removeItem('whatsy_agent')
    window.location.href = '/login'
  }

  return (
    <>
      {/* Desktop: left vertical nav */}
      <nav className="hidden md:flex flex-col w-[220px] min-h-screen bg-[#f0f2f5] dark:bg-[#111b21] border-r border-[#e9edef] dark:border-[#222e35] py-4 px-3 shrink-0">

        {/* Logo */}
        <div className="flex items-center gap-2.5 px-1 mb-6">
          <div className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="white">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </div>
          <span className="text-[#111b21] dark:text-[#e9edef] font-bold text-lg tracking-tight">Whatsy</span>
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-0.5 flex-1">
          {visibleNavItems.map(item => (
            <NavItem key={item.href} href={item.href} icon={item.icon} label={t[item.labelKey]} path={path} badge={item.href === '/' ? totalUnread : undefined} />
          ))}
        </div>

        {/* Bottom: dark mode + language + agent */}
        <div className="border-t border-gray-200 dark:border-[#222e35] pt-3 mt-3 space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-gray-500 dark:text-[#8696a0] text-xs">{t.nav_theme}</span>
            <DarkModeButton />
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="text-gray-500 dark:text-[#8696a0] text-xs">{t.nav_language}</span>
            <LanguageToggleButton />
          </div>
          {agent && (
            <div className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#2a3942] transition-colors group">
              <div className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-gray-900 dark:text-[#e9edef] text-sm font-medium truncate leading-tight">{agent.name}</p>
                <div className="mt-0.5">
                  <RoleBadge role={agent.role || 'agent'} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordModal(true)}
                title={t.nav_change_password}
                className="p-1.5 text-gray-400 hover:text-[#00a884] dark:hover:text-[#00a884] rounded-lg hover:bg-gray-200 dark:hover:bg-[#374248] transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleLogout}
                title={t.nav_sign_out}
                className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-200 dark:hover:bg-[#374248] transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </nav>

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />

      {/* Mobile: bottom tab bar — hidden while a chat is open */}
      <nav className={`md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-[#111b21] border-t border-gray-200 dark:border-[#222e35] flex justify-around items-center h-14 px-2 transition-transform duration-200 ${path === '/' && activeConversationId && isMobileChatOpen ? 'translate-y-full pointer-events-none' : 'translate-y-0'}`}>
        {visibleNavItems.map(item => {
          const active = path === item.href || (item.href !== '/' && path.startsWith(item.href))
          const badge = item.href === '/' ? totalUnread : 0
          return (
            <button
              key={item.href}
              onClick={() => navigate(item.href)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[44px] min-h-[44px] justify-center
                ${active ? 'text-[#00a884]' : 'text-[#8696a0]'}`}
            >
              <span className="relative">
                {item.icon}
                {badge > 0 && (
                  <span className="absolute -top-1.5 end-[-6px] min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{t[item.labelKey]}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
