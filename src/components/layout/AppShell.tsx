import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import BottomNav from './BottomNav';

function SplashScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-card-md animate-pulse">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <p className="text-text-secondary text-sm">טוען...</p>
      </div>
    </div>
  );
}

export default function AppShell() {
  const { session, loading } = useAuth();

  if (loading) return <SplashScreen />;
  if (!session) return <Navigate to="/login" replace />;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Top safe area */}
      <div className="safe-top" />

      {/* Page header */}
      <header className="bg-white border-b border-border px-4 py-3 max-w-mobile mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <span className="font-bold text-text-primary text-base">GuardFlow</span>
        </div>
      </header>

      {/* Page content — scrollable area above bottom nav */}
      <main className="flex-1 overflow-y-auto pb-20 max-w-mobile mx-auto w-full flex flex-col">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
