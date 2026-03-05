import { Outlet, NavLink, useLocation } from 'react-router-dom'

function NavIcon({ to, label, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 px-4 py-2 text-xs font-medium transition-colors ${
          isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
        }`
      }
    >
      <span className="w-6 h-6">{children}</span>
      <span>{label}</span>
    </NavLink>
  )
}

// Simple SVG icons
const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className="flex-1 overflow-y-auto pb-20">
        <div className="max-w-2xl mx-auto">
          <Outlet />
        </div>
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 flex justify-around safe-area-inset-bottom z-50">
        <NavIcon to="/" label="Home"><HomeIcon /></NavIcon>
        <NavIcon to="/search" label="Search"><SearchIcon /></NavIcon>
        <NavIcon to="/settings" label="Settings"><SettingsIcon /></NavIcon>
      </nav>
    </div>
  )
}
