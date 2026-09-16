import React, { useEffect } from 'react'
import { useInboxStore } from './store/useInboxStore'
import { useWebSocket } from './store/useWebSocket'
import { getConversations } from './api/inbox'
import { WhatsAppInboxApp } from './components/WhatsAppInboxApp'
import NavBar from './components/NavBar'
import LoginPage from './pages/LoginPage'
import StudentsPage from './pages/StudentsPage'
import BroadcastPage from './pages/BroadcastPage'
import AutoReplyPage from './pages/AutoReplyPage'

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

  if (path === '/login') return <LoginPage />

  if (!jwt) {
    window.location.href = '/login'
    return null
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-[#0b141a] overflow-hidden">
      <NavBar path={path} />
      <main className="flex-1 flex flex-col min-w-0 pb-14 md:pb-0">
        <AppContent path={path} />
      </main>
    </div>
  )
}

function AppContent({ path }: { path: string }) {
  if (path === '/students') return <StudentsPage />
  if (path === '/broadcasts') return <BroadcastPage />
  if (path === '/settings') return <AutoReplyPage />
  return <InboxApp />
}

function InboxApp() {
  useWebSocket()
  const setConversations = useInboxStore((s) => s.setConversations)

  useEffect(() => {
    getConversations()
      .then(setConversations)
      .catch((err) => console.error('[App] failed to load conversations:', err))
  }, [setConversations])

  return <WhatsAppInboxApp />
}

export default function App() {
  return <Router />
}
