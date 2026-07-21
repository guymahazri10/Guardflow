import { FormEvent, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import logoFull from '../assets/logo_full.png'

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
    <section dir="rtl" className="mx-auto flex min-h-[80vh] w-full max-w-mobile items-center px-6 py-8">
      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={logoFull} alt="GuardFlow" className="h-auto w-[150px]" />
        </div>

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
    </section>
  )
}
