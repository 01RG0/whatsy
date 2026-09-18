import type { ZernioConversation, ZernioMessage, SendMessagePayload, ConversationFilter } from '../components/types'
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('whatsy_jwt')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function throwIfError(res: Response): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`[${res.status}] ${text}`)
  }
}

export async function getConversations(
  filter: ConversationFilter = 'all',
  search = '',
  limit = 50,
  before?: string,
): Promise<ZernioConversation[]> {
  const params = new URLSearchParams({
    platform: 'whatsapp',
    filter,
    limit: String(limit),
    ...(search ? { search } : {}),
    ...(before ? { before } : {}),
  })
  const res = await fetch(`${API_BASE}/v1/inbox/conversations?${params}`, {
    headers: getAuthHeader(),
  })
  await throwIfError(res)
  const json = await res.json() as { conversations?: ZernioConversation[] } | ZernioConversation[]
  return Array.isArray(json) ? json : (json.conversations ?? [])
}

export async function getMessages(
  conversationId: string,
  limit = 100,
  before?: string,
): Promise<ZernioMessage[]> {
  const params = new URLSearchParams({ limit: String(limit), _t: String(Date.now()) })
  if (before) params.set('before', before)
  const res = await fetch(`${API_BASE}/v1/inbox/conversations/${conversationId}/messages?${params}`, {
    headers: { ...getAuthHeader(), 'Cache-Control': 'no-cache' },
  })
  await throwIfError(res)
  const json = await res.json() as { messages?: ZernioMessage[] } | ZernioMessage[]
  return Array.isArray(json) ? json : (json.messages ?? [])
}

export async function sendMessage(
  conversationId: string,
  payload: Partial<SendMessagePayload>,
): Promise<ZernioMessage> {
  const res = await fetch(`${API_BASE}/v1/inbox/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
      ...getAuthHeader(),
    },
    body: JSON.stringify(payload),
  })
  await throwIfError(res)
  return res.json() as Promise<ZernioMessage>
}

export async function markRead(conversationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/inbox/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: getAuthHeader(),
  })
  await throwIfError(res)
}

export async function assignConversation(conversationId: string, agentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/inbox/conversations/${conversationId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ agentId }),
  })
  await throwIfError(res)
}

export interface AgentSummary {
  id: string
  name: string
  email: string
  role: string
  avatar: string
}

export async function getAgents(): Promise<AgentSummary[]> {
  const res = await fetch(`${API_BASE}/v1/agents`, { headers: getAuthHeader() })
  await throwIfError(res)
  return res.json() as Promise<AgentSummary[]>
}
