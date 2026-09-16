import DarkModeToggle from './DarkModeToggle'

const path = window.location.pathname

const navItems = [
  { href: '/', icon: '💬', label: 'Inbox' },
  { href: '/students', icon: '👥', label: 'Students' },
  { href: '/broadcasts', icon: '📢', label: 'Broadcasts' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
]

function NavIcon({ href, icon, label }: { href: string; icon: string; label: string }) {
  const active = path === href || (href !== '/' && path.startsWith(href))
  return (
    <a
      href={href}
      title={label}
      className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg transition-colors min-h-[44px] min-w-[44px]
        md:w-full md:flex-row md:gap-3 md:px-3 md:justify-start
        ${active ? 'bg-[#00a884]/20 text-[#00a884]' : 'text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942]'}`}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-[10px] md:text-sm font-medium">{label}</span>
    </a>
  )
}

export default function NavBar() {
  const agentRaw = localStorage.getItem('whatsy_agent')
  const agent = agentRaw ? JSON.parse(agentRaw) : null
  const initials = agent?.name ? agent.name.slice(0, 2).toUpperCase() : '?'

  return (
    <>
      {/* Desktop: left side vertical nav */}
      <nav className="hidden md:flex flex-col w-[220px] min-h-screen bg-[#111b21] border-r border-[#222e35] py-4 px-2 gap-1 shrink-0">
        <div className="flex items-center gap-2 px-3 mb-6">
          <div className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold text-sm">W</div>
          <span className="text-[#e9edef] font-semibold text-lg">Whatsy</span>
        </div>
        <DarkModeToggle />
        <div className="flex flex-col gap-1 mt-2 flex-1">
          {navItems.map((item) => (
            <NavIcon key={item.href} {...item} />
          ))}
        </div>
        {agent && (
          <div className="flex items-center gap-2 px-3 pt-4 border-t border-[#222e35]">
            <div className="w-8 h-8 rounded-full bg-[#00a884] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-[#e9edef] text-sm font-medium truncate">{agent.name}</p>
              <p className="text-[#8696a0] text-xs truncate">{agent.role ?? 'agent'}</p>
            </div>
          </div>
        )}
      </nav>

      {/* Mobile: bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#111b21] border-t border-[#222e35] flex justify-around items-center h-14 px-2">
        {navItems.map((item) => (
          <NavIcon key={item.href} {...item} />
        ))}
      </nav>
    </>
  )
}
