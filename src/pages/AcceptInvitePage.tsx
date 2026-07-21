import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import logoIcon from '../assets/logo_icon.png'

export function AcceptInvitePage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    if (password.length < 6) {
      setErrorMessage('הסיסמה חייבת להכיל לפחות 6 תווים.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('הסיסמאות אינן תואמות.')
      return
    }

    setSubmitting(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        throw error
      }

      toast.success('הסיסמה נקבעה בהצלחה')
      navigate('/shift-live', { replace: true })
    } catch (error) {
      console.error('Failed to set password', error)
      setErrorMessage('קביעת הסיסמה נכשלה. נסה שוב או בקש הזמנה חדשה.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile items-center justify-center px-4 text-text-secondary">
        טוען...
      </section>
    )
  }

  if (!session) {
    return (
      <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile flex-col items-center justify-center px-4 text-center gap-3">
        <h2 className="text-xl font-bold text-text-primary">הקישור אינו תקף</h2>
        <p className="text-sm text-text-secondary">ייתכן שהקישור פג תוקף או שכבר נעשה בו שימוש. בקש מהמנהל הזמנה חדשה.</p>
        <a href="/login" className="btn-primary mt-2 inline-block">
          חזרה למסך ההתחברות
        </a>
      </section>
    )
  }

  return (
    <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile items-center px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full card p-5 flex flex-col gap-4">
        <div className="flex flex-col items-center text-center">
          <img src={logoIcon} alt="" className="mb-3 h-9 w-auto" />
          <p className="text-sm text-text-secondary">קבע סיסמה כדי להשלים את ההרשמה.</p>
        </div>

        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="סיסמה חדשה"
          autoFocus
          required
          autoComplete="new-password"
          disabled={submitting}
          dir="ltr"
          className="input-field w-full"
        />

        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="אימות סיסמה"
          required
          autoComplete="new-password"
          disabled={submitting}
          dir="ltr"
          className="input-field w-full"
        />

        {errorMessage && <p className="text-sm font-medium text-red-600">{errorMessage}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full h-12 rounded-xl disabled:opacity-50">
          {submitting ? 'שומר...' : 'קבע סיסמה והמשך'}
        </button>
      </form>
    </section>
  )
}
