import { useDarkModeStore } from '../store/useDarkModeStore'

export default function DarkModeToggle() {
  const { dark, toggle } = useDarkModeStore()

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-lg text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
        </svg>
      )}
    </button>
  )
}
