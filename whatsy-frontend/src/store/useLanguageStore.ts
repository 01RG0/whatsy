import { create } from 'zustand'

export type Lang = 'en' | 'ar'

interface LanguageState {
  lang: Lang
  setLang: (l: Lang) => void
}

const storedLang = (localStorage.getItem('whatsy_lang') as Lang) ?? 'en'
document.documentElement.dir = storedLang === 'ar' ? 'rtl' : 'ltr'
document.documentElement.lang = storedLang

export const useLanguageStore = create<LanguageState>((set) => ({
  lang: storedLang,
  setLang: (lang) => {
    localStorage.setItem('whatsy_lang', lang)
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
    set({ lang })
  },
}))
