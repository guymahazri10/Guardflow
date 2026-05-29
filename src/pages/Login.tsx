import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

type Mode = 'login' | 'magic';

export default function Login() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  if (loading) return <SplashScreen />;
  if (session) return <Navigate to="/shift-live" replace />;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : error.message);
    setSubmitting(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      toast.error('שגיאה בשליחת קישור. נסה שנית.');
    } else {
      setMagicSent(true);
      toast.success('קישור כניסה נשלח לאימייל שלך');
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-mobile">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-card-md">
            <ShieldIcon />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">GuardFlow</h1>
          <p className="text-text-secondary text-sm mt-1">מערכת ניהול משמרות אבטחה</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          {/* Mode tabs */}
          <div className="flex border-b border-border mb-6 gap-2">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'login' ? 'tab-active' : 'tab-inactive'}`}
            >
              כניסה עם סיסמה
            </button>
            <button
              onClick={() => setMode('magic')}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'magic' ? 'tab-active' : 'tab-inactive'}`}
            >
              קישור כניסה
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">אימייל</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">סיסמה</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  dir="ltr"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !email || !password}
                className="btn-primary w-full mt-2"
              >
                {submitting ? 'מתחבר...' : 'כניסה'}
              </button>
            </form>
          ) : magicSent ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">📧</div>
              <p className="font-semibold text-text-primary">קישור כניסה נשלח!</p>
              <p className="text-text-secondary text-sm mt-1">בדוק את תיבת הדואר שלך</p>
              <p className="text-text-muted text-xs mt-1 dir-ltr">{email}</p>
              <button
                onClick={() => { setMagicSent(false); setEmail(''); }}
                className="btn-ghost mt-4"
              >
                שלח שוב
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">אימייל</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  dir="ltr"
                />
              </div>
              <p className="text-text-secondary text-xs">
                נשלח לך קישור כניסה חד-פעמי לאימייל
              </p>
              <button
                type="submit"
                disabled={submitting || !email}
                className="btn-primary w-full"
              >
                {submitting ? 'שולח...' : 'שלח קישור כניסה'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-text-muted text-xs mt-6">
          GuardFlow v1.0 · מערכת פנימית
        </p>
      </div>
    </div>
  );
}

function SplashScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-card-md animate-pulse">
          <ShieldIcon />
        </div>
        <p className="text-text-secondary text-sm">טוען...</p>
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
