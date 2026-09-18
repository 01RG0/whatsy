import React, { useEffect } from 'react'
import { WhatsAppInboxApp } from './components/WhatsAppInboxApp'
import NavBar from './components/NavBar'
import LoginPage from './pages/LoginPage'
import StudentsPage from './pages/StudentsPage'
import AutoReplyPage from './pages/AutoReplyPage'
import WhatsAppConnectionPage from './pages/WhatsAppConnectionPage'
import TeamPage from './pages/TeamPage'
import { isAdmin } from './lib/auth'
import { API_BASE, getAuthHeader } from './api/inbox'

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

  useEffect(() => {
    if (!jwt) return
    fetch(`${API_BASE}/v1/agents/me`, { headers: getAuthHeader() })
      .then(async (res) => {
        if (!res.ok) return
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
    <div className="flex h-[100dvh] bg-[#f0f2f5] dark:bg-[#0b141a] overflow-hidden">
      <NavBar path={path} />
      <main className="flex-1 flex flex-col min-w-0 pb-14 md:pb-0">
        <AppContent path={path} />
      </main>
    </div>
  )
}

function AppContent({ path }: { path: string }) {
  const adminRoutes = ['/team', '/settings', '/connection']
  if (adminRoutes.includes(path) && !isAdmin()) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-sm mb-6">
          You don't have administrator permissions to access this page. Please contact your administrator.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-[#00a884] hover:bg-[#008f6f] text-white font-medium rounded-lg transition-colors"
        >
          Return to Inbox
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
