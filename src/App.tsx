import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import ShiftLive from './pages/ShiftLive';
import ShiftSetup from './pages/ShiftSetup';
import AdminPanel from './pages/AdminPanel';
import Profile from './pages/Profile';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: '14px',
              borderRadius: '12px',
              direction: 'rtl',
            },
            success: { iconTheme: { primary: '#116dff', secondary: '#fff' } },
          }}
        />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/shift-live" replace />} />
            <Route path="/shift-live" element={<ShiftLive />} />
            <Route path="/shift-setup" element={<ShiftSetup />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/shift-live" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
