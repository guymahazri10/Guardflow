import { FormEvent, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import logoFull from '../assets/logo_full.png'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

export function LoginPage() {
  const { signIn, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrorMessage(null)

    try {
      await signIn(email, password)
    } catch (error) {
      console.error('Login failed', error)
      setErrorMessage('התחברות נכשלה. בדוק אימייל וסיסמה.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGoogle() {
    setGoogleSubmitting(true)
    setErrorMessage(null)

    try {
      await signInWithGoogle()
      // Supabase redirects to Google from here; this component unmounts.
    } catch (error) {
      console.error('Google sign-in failed', error)
      setErrorMessage('התחברות עם Google נכשלה. נסה שוב.')
      setGoogleSubmitting(false)
    }
  }

  return (
    <section dir="rtl" className="mx-auto flex min-h-[80vh] w-full max-w-mobile items-center px-6 py-8">
      <div className="w-full">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={logoFull} alt="GuardFlow" className="h-auto w-[150px]" />
        </div>

        <button
          type="button"
          onClick={() => {
            void handleGoogle()
          }}
          disabled={googleSubmitting || submitting}
          className="w-full flex items-center justify-center gap-2.5 rounded-full border border-border bg-white py-3.5 text-[15px] font-bold text-text-primary disabled:opacity-50"
        >
          <GoogleIcon />
          {googleSubmitting ? 'מעביר ל-Google...' : 'המשך עם Google'}
        </button>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-text-muted">או</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-xs font-bold text-text-secondary">
            אימייל
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              disabled={submitting}
              className="input-field mt-2 text-left"
              dir="ltr"
            />
          </label>

          <label className="block text-xs font-bold text-text-secondary">
            סיסמה
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              disabled={submitting}
              className="input-field mt-2 text-left"
              dir="ltr"
            />
          </label>

          {errorMessage ? <p className="text-sm font-medium text-danger">{errorMessage}</p> : null}

          <button type="submit" disabled={submitting} className="btn-primary w-full !py-3.5 text-[15px]">
            {submitting ? 'מתחבר...' : 'התחבר'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-text-muted">
          משתמש חדש? מנהל המערכת צריך להזמין אותך קודם — לא ניתן להירשם עצמאית.
        </p>
      </div>
    </section>
  )
}
