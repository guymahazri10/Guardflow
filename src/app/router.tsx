import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
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
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route path="/shift-setup" element={<ShiftSetupPage />} />
        <Route path="/shift-live" element={<ShiftLivePage />} />
        <Route path="/admin" element={<AdminPanelPage />} />
        <Route path="/roster-editor" element={<RosterEditorPage />} />
        <Route path="/users" element={<UserManagementPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
