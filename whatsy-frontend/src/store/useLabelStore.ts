import { create } from 'zustand'
import type { Label } from '../components/types'
import { getLabels, createLabel, updateLabel, deleteLabel } from '../api/inbox'

interface LabelState {
  labels: Label[]
  activeLabelId: string | null

  fetch: () => Promise<void>
  add: (name: string, color: string) => Promise<Label>
  update: (id: string, name: string, color: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setActiveLabel: (id: string | null) => void
  getByName: (name: string) => Label | undefined
  getById: (id: string) => Label | undefined
}

export const useLabelStore = create<LabelState>((set, get) => ({
  labels: [],
  activeLabelId: null,

  fetch: async () => {
    const labels = await getLabels()
    set({ labels })
  },

  add: async (name, color) => {
    const label = await createLabel(name, color)
    set((s) => ({ labels: [...s.labels, label].sort((a, b) => a.name.localeCompare(b.name)) }))
    return label
  },

  update: async (id, name, color) => {
    const label = await updateLabel(id, name, color)
    set((s) => ({
      labels: s.labels
        .map((l) => (l.id === id ? label : l))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
  },

  remove: async (id) => {
    await deleteLabel(id)
    set((s) => ({ labels: s.labels.filter((l) => l.id !== id) }))
  },

  setActiveLabel: (id) => set({ activeLabelId: id }),

  getByName: (name) => get().labels.find((l) => l.name === name),
  getById: (id) => get().labels.find((l) => l.id === id),
}))
