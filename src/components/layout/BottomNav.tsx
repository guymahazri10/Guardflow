import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: (active: boolean) => ReactElement;
  adminOnly?: boolean;
  editorOnly?: boolean;
}

const ACTIVE = '#ffffff';
const INACTIVE = '#6F7782';

const NAV_ITEMS: NavItem[] = [
  {
    to: '/shift-live',
    label: 'שידור חי',
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    to: '/shift-setup',
    label: 'שיבוץ',
    editorOnly: true,
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    to: '/admin',
    label: 'ניהול',
    adminOnly: true,
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    to: '/users',
    label: 'משתמשים',
    adminOnly: true,
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: '/profile',
    label: 'פרופיל',
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="7" r="4" />
        <path d="M5.5 21a8.38 8.38 0 0 1 13 0" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const { isAdmin, isCommander } = useAuth();

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.editorOnly && !isAdmin && !isCommander) return false;
    return true;
  });

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 px-3 pb-3 safe-bottom">
      <div className="max-w-mobile mx-auto flex items-center justify-around bg-white/85 backdrop-blur-md border border-black/[0.06] rounded-full shadow-card-md py-1.5 px-1">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex flex-col items-center gap-1 px-2.5 py-1"
          >
            {({ isActive }) => (
              <>
                <span
                  className={`w-[26px] h-[26px] rounded-full flex items-center justify-center transition-colors ${
                    isActive ? 'bg-primary' : ''
                  }`}
                >
                  {item.icon(isActive)}
                </span>
                <span className={`text-[9.5px] ${isActive ? 'font-extrabold text-primary' : 'font-medium text-text-secondary'}`}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
