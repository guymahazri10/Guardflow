import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { AdminRoute } from '../components/routes/AdminRoute'
import { LoadingSplash, ProtectedRoute } from '../components/routes/ProtectedRoute'
import { useAuth } from '../contexts/AuthContext'
import { AdminPanelPage } from '../pages/AdminPanelPage'
import { LoginPage } from '../pages/LoginPage'
import { ProfilePage } from '../pages/ProfilePage'
import { RosterEditorPage } from '../pages/RosterEditorPage'
import { ShiftLivePage } from '../pages/ShiftLivePage'
import { ShiftSetupPage } from '../pages/ShiftSetupPage'
import { UserManagementPage } from '../pages/UserManagementPage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/shift-live" element={<ShiftLivePage />} />
          <Route path="/shift-setup" element={<ShiftSetupPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPanelPage />} />
            <Route path="/roster-editor" element={<RosterEditorPage />} />
            <Route path="/users" element={<UserManagementPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function LoginRoute() {
  const { loading, session } = useAuth()

  if (loading) {
    return <LoadingSplash />
  }

  if (session) {
    return <Navigate to="/shift-live" replace />
  }

  return <LoginPage />
}
