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
