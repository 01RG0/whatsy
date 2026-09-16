import { useEffect } from 'react'
import { useInboxStore } from './store/useInboxStore'
import { useWebSocket } from './store/useWebSocket'
import { getConversations } from './api/inbox'
import { WhatsAppInboxApp } from './components/WhatsAppInboxApp'
import LoginPage from './pages/LoginPage'
import StudentsPage from './pages/StudentsPage'

const path = window.location.pathname

function Router() {
  const jwt = localStorage.getItem('whatsy_jwt')

  if (path === '/login') return <LoginPage />
  if (!jwt) {
    window.location.href = '/login'
    return null
  }
  if (path === '/students') return <StudentsPage />
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
