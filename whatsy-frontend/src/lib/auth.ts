export type UserRole = 'admin' | 'agent' | 'viewer'

export interface CurrentAgent {
  id: string
  name: string
  email: string
  role: UserRole
  avatar?: string
}

export function getCurrentAgent(): CurrentAgent | null {
  try {
    const raw = localStorage.getItem('whatsy_agent')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const role: UserRole = ['admin', 'agent', 'viewer'].includes(parsed.role) ? parsed.role : 'agent'
    return {
      id: parsed.id || '',
      name: parsed.name || '',
      email: parsed.email || '',
      role,
      avatar: parsed.avatar || '',
    }
  } catch {
    return null
  }
}

export function isAdmin(): boolean {
  const agent = getCurrentAgent()
  return agent?.role === 'admin'
}

export function isViewer(): boolean {
  const agent = getCurrentAgent()
  return agent?.role === 'viewer'
}

export function canWrite(): boolean {
  const agent = getCurrentAgent()
  return agent?.role === 'admin' || agent?.role === 'agent'
}

export interface SavedAccount {
  id: string
  name: string
  email: string
  avatar: string
  role: UserRole
  token: string
}

export function getSavedAccounts(): SavedAccount[] {
  try {
    const list: SavedAccount[] = JSON.parse(localStorage.getItem('whatsy_accounts') || '[]')
    const currentToken = localStorage.getItem('whatsy_jwt')
    const currentAgent = getCurrentAgent()
    if (currentToken && currentAgent && currentAgent.id && !list.some(a => a.id === currentAgent.id)) {
      list.unshift({
        id: currentAgent.id,
        name: currentAgent.name,
        email: currentAgent.email,
        avatar: currentAgent.avatar || '',
        role: currentAgent.role || 'agent',
        token: currentToken,
      })
      localStorage.setItem('whatsy_accounts', JSON.stringify(list))
    }
    return list
  } catch {
    return []
  }
}

export function switchAccount(acc: SavedAccount) {
  localStorage.setItem('whatsy_jwt', acc.token)
  localStorage.setItem('whatsy_agent', JSON.stringify({
    id: acc.id,
    name: acc.name,
    email: acc.email,
    avatar: acc.avatar,
    role: acc.role,
  }))
  window.location.reload()
}

export function logoutCurrentAccount() {
  const currentAgent = getCurrentAgent()
  const accounts = getSavedAccounts().filter(a => a.id !== currentAgent?.id)
  localStorage.setItem('whatsy_accounts', JSON.stringify(accounts))
  localStorage.removeItem('whatsy_jwt')
  localStorage.removeItem('whatsy_agent')
  if (accounts.length > 0) {
    localStorage.setItem('whatsy_jwt', accounts[0].token)
    localStorage.setItem('whatsy_agent', JSON.stringify({
      id: accounts[0].id,
      name: accounts[0].name,
      email: accounts[0].email,
      avatar: accounts[0].avatar,
      role: accounts[0].role,
    }))
  }
  window.location.href = accounts.length > 0 ? '/' : '/login'
}
