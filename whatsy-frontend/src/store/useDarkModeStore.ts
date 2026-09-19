import { create } from 'zustand'

interface DarkModeStore {
  dark: boolean
  toggle: () => void
  set: (value: boolean) => void
}

const apply = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem('whatsy_dark', String(dark))
}

export const useDarkModeStore = create<DarkModeStore>(() => ({
  dark: document.documentElement.classList.contains('dark'),
  toggle: () => useDarkModeStore.setState((s) => {
    const next = !s.dark
    apply(next)
    return { dark: next }
  }),
  set: (value: boolean) => useDarkModeStore.setState(() => {
    apply(value)
    return { dark: value }
  }),
}))
