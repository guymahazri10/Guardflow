import { FormEvent, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
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

  return (
    <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-8 text-right">
      <form onSubmit={handleSubmit} className="w-full space-y-5">
        <div>
          <h2 className="mb-2 text-2xl font-bold text-slate-900">התחברות</h2>
          <p className="text-sm text-slate-600">כניסה למערכת GuardFlow עם חשבון Supabase.</p>
        </div>

        <label className="block text-sm font-medium text-slate-700">
          אימייל
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            disabled={submitting}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-left text-slate-900 disabled:bg-slate-100"
            dir="ltr"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          סיסמה
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
            disabled={submitting}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-left text-slate-900 disabled:bg-slate-100"
            dir="ltr"
          />
        </label>

        {errorMessage ? <p className="text-sm font-medium text-red-700">{errorMessage}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {submitting ? 'מתחבר...' : 'התחבר'}
        </button>
      </form>
    </section>
  )
}
