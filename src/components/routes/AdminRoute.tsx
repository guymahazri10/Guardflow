import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { LoadingSplash, ProfileProblemScreen } from './ProtectedRoute'

const PROFILE_ERROR_STATUSES = ['missing', 'invalid', 'error'] as const

export function AdminRoute({ children }: { children?: ReactNode }) {
  const { loading, session, profileStatus, isAdmin } = useAuth()
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

  if (!isAdmin) {
    return <Navigate to="/shift-live" replace />
  }

  return children ? <>{children}</> : <Outlet />
}
