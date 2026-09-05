import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { AdminRoute } from '../components/routes/AdminRoute'
import { EditorRoute } from '../components/routes/EditorRoute'
import { LoadingSplash, ProtectedRoute } from '../components/routes/ProtectedRoute'
import { useAuth } from '../contexts/AuthContext'
import { AcceptInvitePage } from '../pages/AcceptInvitePage'
import { AdminPanelPage } from '../pages/AdminPanelPage'
import { LoginPage } from '../pages/LoginPage'
import { ProfilePage } from '../pages/ProfilePage'
import { RosterEditorPage } from '../pages/RosterEditorPage'
import { ScheduleImportPage } from '../pages/ScheduleImportPage'
import { ShiftLivePage } from '../pages/ShiftLivePage'
import { ShiftSetupPage } from '../pages/ShiftSetupPage'
import { ShiftTemplateEditorPage } from '../pages/ShiftTemplateEditorPage'
import { ShiftTemplatesPage } from '../pages/ShiftTemplatesPage'
import { UserManagementPage } from '../pages/UserManagementPage'
import { WeeklySchedulePage } from '../pages/WeeklySchedulePage'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/shift-live" element={<ShiftLivePage />} />
          <Route path="/weekly-schedule" element={<WeeklySchedulePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route element={<EditorRoute />}>
            <Route path="/shift-setup" element={<ShiftSetupPage />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPanelPage />} />
            <Route path="/roster-editor" element={<RosterEditorPage />} />
            <Route path="/users" element={<UserManagementPage />} />
            <Route path="/shift-templates" element={<ShiftTemplatesListOrEditor />} />
            <Route path="/schedule-import" element={<ScheduleImportPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

function ShiftTemplatesListOrEditor() {
  const [searchParams] = useSearchParams()
  return searchParams.get('shiftId') ? <ShiftTemplateEditorPage /> : <ShiftTemplatesPage />
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
