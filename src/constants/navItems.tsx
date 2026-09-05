import type { ReactElement } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: (active: boolean) => ReactElement
  adminOnly?: boolean
  editorOnly?: boolean
}

const ACTIVE = '#ffffff'
const INACTIVE = '#6F7782'

export const NAV_ITEMS: NavItem[] = [
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
    to: '/weekly-schedule',
    label: 'לוח שבועי',
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="9" y1="10" x2="9" y2="20" />
        <line x1="15" y1="10" x2="15" y2="20" />
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
]

export function getVisibleNavItems(isAdmin: boolean, isCommander: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    if (item.editorOnly && !isAdmin && !isCommander) return false
    return true
  })
}
