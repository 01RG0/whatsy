import { create } from 'zustand'
import { API_BASE, getAuthHeader } from '../api/inbox'

export interface WorkspaceSettings {
  interactive_messages_enabled: boolean
  canned_responses_enabled: boolean
  auto_reply_enabled: boolean
  typing_indicators_enabled: boolean
  [key: string]: boolean | string
}

const DEFAULTS: WorkspaceSettings = {
  interactive_messages_enabled: false,
  canned_responses_enabled: true,
  auto_reply_enabled: true,
  typing_indicators_enabled: true,
}

interface SettingsStore {
  settings: WorkspaceSettings
  loading: boolean
  saving: boolean
  loaded: boolean
  fetch: () => Promise<void>
  update: (patch: Partial<WorkspaceSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: { ...DEFAULTS },
  loading: false,
  saving: false,
  loaded: false,

  fetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await fetch(`${API_BASE}/v1/settings`, { headers: getAuthHeader() })
      if (res.ok) {
        const data = await res.json()
        set({ settings: { ...DEFAULTS, ...data }, loaded: true })
      }
    } catch {
      // fall back to defaults silently
    } finally {
      set({ loading: false })
    }
  },

  update: async (patch) => {
    set({ saving: true })
    try {
      const res = await fetch(`${API_BASE}/v1/settings`, {
        method: 'PUT',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const data = await res.json()
        set({ settings: { ...DEFAULTS, ...data } })
      }
    } finally {
      set({ saving: false })
    }
  },
}))
