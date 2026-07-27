import { NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getVisibleNavItems } from '../../constants/navItems'
import logoFull from '../../assets/logo_full.png'

export default function Sidebar() {
  const { isAdmin, isCommander, profile, appRole, signOut } = useAuth()
  const visibleItems = getVisibleNavItems(isAdmin, isCommander)

  return (
    <aside className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col border-l border-border bg-white">
      <div className="px-5 py-6">
        <img src={logoFull} alt="GuardFlow" className="h-8 w-auto" />
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {visibleItems.map((item) => (
          <NavLink key={item.to} to={item.to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors">
            {({ isActive }) => (
              <>
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    isActive ? 'bg-primary' : ''
                  }`}
                >
                  {item.icon(isActive)}
                </span>
                <span className={`text-sm ${isActive ? 'font-extrabold text-primary' : 'font-medium text-text-secondary'}`}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-4 flex flex-col gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{profile?.full_name ?? '—'}</p>
          <p className="text-xs text-text-muted">{appRole ?? ''}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void signOut()
          }}
          className="btn-ghost w-full text-sm"
        >
          התנתקות
        </button>
      </div>
    </aside>
  )
}
