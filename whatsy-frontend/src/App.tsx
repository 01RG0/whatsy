import React, { useEffect, useState } from 'react'
import { WhatsAppInboxApp } from './components/WhatsAppInboxApp'
import NavBar from './components/NavBar'
import LoginPage from './pages/LoginPage'
import StudentsPage from './pages/StudentsPage'
import AutoReplyPage from './pages/AutoReplyPage'
import WhatsAppConnectionPage from './pages/WhatsAppConnectionPage'
import TeamPage from './pages/TeamPage'
import { isAdmin } from './lib/auth'
import { API_BASE, getAuthHeader } from './api/inbox'
import { useT } from './i18n/translations'

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
  const t = useT()
  const path = usePath()
  const jwt = localStorage.getItem('whatsy_jwt')
  const [sessionBanner, setSessionBanner] = useState(false)

  useEffect(() => {
    const handler = () => {
      localStorage.removeItem('whatsy_jwt')
      localStorage.removeItem('whatsy_agent')
      setSessionBanner(true)
      setTimeout(() => { window.location.replace('/login') }, 2500)
    }
    window.addEventListener('whatsy:session_invalidated', handler)
    return () => window.removeEventListener('whatsy:session_invalidated', handler)
  }, [])

  useEffect(() => {
    if (!jwt) return
    fetch(`${API_BASE}/v1/agents/me`, { headers: getAuthHeader() })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            const body = await res.text().catch(() => '')
            try { if (JSON.parse(body).error === 'session_invalidated') window.dispatchEvent(new CustomEvent('whatsy:session_invalidated')) } catch { /* ignore */ }
          }
          return
        }
        const data = await res.json()
        if (data && data.id) {
          if (data.token) {
            localStorage.setItem('whatsy_jwt', data.token)
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

  if (path === '/login') return <LoginPage />

  if (!jwt) {
    window.location.href = '/login'
    return null
  }

  return (
    <>
      {sessionBanner && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#202c33] rounded-2xl shadow-2xl px-8 py-7 max-w-sm w-full mx-4 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h3 className="text-[#111b21] dark:text-[#e9edef] font-semibold text-lg mb-2">{t.signed_in_elsewhere}</h3>
            <p className="text-[#54656f] dark:text-[#8696a0] text-sm">{t.signed_in_elsewhere_body}</p>
          </div>
        </div>
      )}
      <div className="flex h-[100dvh] bg-[#f0f2f5] dark:bg-[#0b141a] overflow-hidden">
        <NavBar path={path} />
        <main className="flex-1 flex flex-col min-w-0 pb-14 md:pb-0">
          <AppContent path={path} />
        </main>
      </div>
    </>
  )
}

function AppContent({ path }: { path: string }) {
  const t = useT()
  const adminRoutes = ['/team', '/settings', '/connection']
  if (adminRoutes.includes(path) && !isAdmin()) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
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
  if (path === '/settings') return <AutoReplyPage />
  if (path === '/connection') return <WhatsAppConnectionPage />
  if (path === '/team') return <TeamPage />
  return <InboxApp />
}

function InboxApp() {
  return <WhatsAppInboxApp />
}

export default function App() {
  return <Router />
}
