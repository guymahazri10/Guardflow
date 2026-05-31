import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const PROFILE_ERROR_STATUSES = ['missing', 'invalid', 'error'] as const

export function LoadingSplash() {
  return (
    <section dir="rtl" className="mx-auto w-full max-w-md px-4 py-8 text-center text-slate-700">
      טוען...
    </section>
  )
}

export function ProfileProblemScreen() {
  const { signOut } = useAuth()

  return (
    <section dir="rtl" className="mx-auto w-full max-w-md px-4 py-8 text-right">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">בעיה בפרופיל</h2>
      <p className="mb-6 text-slate-700">הפרופיל שלך לא תקין או לא נמצא. פנה למנהל.</p>
      <button
        type="button"
        onClick={() => {
          void signOut()
        }}
        className="rounded bg-slate-900 px-4 py-2 text-white"
      >
        התנתקות
      </button>
    </section>
  )
}

export function ProtectedRoute({ children }: { children?: ReactNode }) {
  const { loading, session, profileStatus } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LoadingSplash />
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (PROFILE_ERROR_STATUSES.includes(profileStatus as (typeof PROFILE_ERROR_STATUSES)[number])) {
    return <ProfileProblemScreen />
  }

  return children ? <>{children}</> : <Outlet />
}
