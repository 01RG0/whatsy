import React, { useEffect, useState } from 'react'
import { WhatsAppInboxApp } from './components/WhatsAppInboxApp'
import NavBar from './components/NavBar'
import LoginPage from './pages/LoginPage'
import StudentsPage from './pages/StudentsPage'
import SettingsPage from './pages/SettingsPage'
import WhatsAppConnectionPage from './pages/WhatsAppConnectionPage'
import TeamPage from './pages/TeamPage'
import AnalysisPage from './pages/AnalysisPage'
import { isAdmin } from './lib/auth'
import { API_BASE, getAuthHeader } from './api/inbox'
import { useT } from './i18n/translations'
import { useWebSocket } from './store/useWebSocket'
import { useSettingsStore } from './store/useSettingsStore'
import { useInboxStore } from './store/useInboxStore'

// Keeps the WebSocket alive on every authenticated page, not just the inbox.
function WebSocketMount({ token, onTokenRefresh }: { token?: string | null; onTokenRefresh?: (token: string) => void }) {
  useWebSocket({ token, onTokenRefresh });
  return null;
}

// Pre-loads workspace settings after login so feature flags are available immediately.
function SettingsMount() {
  const { fetch, loaded } = useSettingsStore()
  useEffect(() => { if (!loaded) fetch() }, [fetch, loaded])
  return null
}

export function navigate(href: string) {
  window.history.pushState({}, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function usePath() {
  const [path, setPath] = React.useState(window.location.pathname)
  useEffect(() => {
    const handler = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])
  return path
}

function Router() {
  const path = usePath()
  const jwt = localStorage.getItem('whatsy_jwt')
  const [validatedToken, setValidatedToken] = useState<string | null>(jwt)

  useEffect(() => {
    if (!jwt) return
    fetch(`${API_BASE}/v1/agents/me`, { headers: getAuthHeader() })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('whatsy_jwt')
            localStorage.removeItem('whatsy_agent')
            window.location.href = '/login'
          }
          return
        }
        const data = await res.json()
        if (data && data.id) {
          if (data.token) {
            localStorage.setItem('whatsy_jwt', data.token)
            setValidatedToken(data.token)
          }
          const raw = localStorage.getItem('whatsy_agent')
          const current = raw ? JSON.parse(raw) : {}
          if (current.role !== data.role || current.name !== data.name) {
            localStorage.setItem(
              'whatsy_agent',
              JSON.stringify({
                id: data.id,
                name: data.name,
                email: data.email,
                role: data.role || 'agent',
                avatar: data.avatar || '',
              })
            )
            window.dispatchEvent(new Event('whatsy_agent_updated'))
          }
        }
      })
      .catch(() => {})
  }, [jwt])

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
    };
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  if (path === '/login') return <LoginPage />

  if (!jwt) {
    window.location.href = '/login'
    return null
  }

  return (
    <>
      <WebSocketMount token={validatedToken} onTokenRefresh={setValidatedToken} />
      <SettingsMount />
      <div style={{ height: 'var(--vvh, 100dvh)' }} className="flex bg-[#f0f2f5] dark:bg-[#0b141a] overflow-hidden">
        <NavBar path={path} />
        <MobileAwareMain path={path} />
      </div>
    </>
  )
}

function MobileAwareMain({ path }: { path: string }) {
  const isMobileChatOpen = useInboxStore((s) => s.isMobileChatOpen);
  return (
    <main className={`flex-1 flex flex-col min-w-0 md:pb-0 ${isMobileChatOpen ? 'pb-0' : 'pb-14'}`}>
      <AppContent path={path} />
    </main>
  );
}

function AppContent({ path }: { path: string }) {
  const t = useT()
  const adminRoutes = ['/team', '/analysis', '/settings', '/connection']
  if (adminRoutes.includes(path) && !isAdmin()) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t.access_denied}</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-sm mb-6">
          {t.access_denied_body}
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-[#00a884] hover:bg-[#008f6f] text-white font-medium rounded-lg transition-colors"
        >
          {t.return_to_inbox}
        </button>
      </div>
    )
  }

  if (path === '/students') return <StudentsPage />
  if (path === '/settings') return <SettingsPage />
  if (path === '/connection') return <WhatsAppConnectionPage />
  if (path === '/team') return <TeamPage />
  if (path === '/analysis') return <AnalysisPage />
  return <InboxApp />
}

function InboxApp() {
  return <WhatsAppInboxApp />
}

export default function App() {
  return <Router />
}
