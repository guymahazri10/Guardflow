import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import { hasActivePushSubscription, subscribeToPush } from '../../lib/pushSubscription'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

function readPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/**
 * Lets the guard explicitly opt in to position-change push alerts, instead of
 * the browser silently prompting on load. Browsers are increasingly strict
 * about only showing the real permission popup in response to a direct
 * click — asking automatically on mount (as this used to) risks being
 * auto-muted. A click here also registers a Web Push subscription, so the
 * change-of-position alert can arrive even when the app isn't open.
 */
export function NotificationBell() {
  const { user } = useAuth()
  const [permission, setPermission] = useState<PermissionState>(readPermission)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPermission(readPermission())
    hasActivePushSubscription()
      .then(setSubscribed)
      .catch(() => setSubscribed(false))
  }, [])

  async function handleClick() {
    if (busy) return

    if (permission === 'unsupported') {
      toast('הדפדפן הזה לא תומך בהתראות', { duration: 4000 })
      return
    }

    if (permission === 'denied') {
      toast('התראות חסומות — יש לאשר אותן בהגדרות הדפדפן/האתר', { duration: 5000 })
      return
    }

    if (permission === 'granted' && subscribed) {
      toast.success('התראות על שינוי עמדה פעילות')
      return
    }

    setBusy(true)
    try {
      let currentPermission: NotificationPermission = permission === 'granted' ? 'granted' : 'default'
      if (currentPermission === 'default') {
        currentPermission = await Notification.requestPermission()
        setPermission(currentPermission)
      }

      if (currentPermission !== 'granted') {
        toast('לא הופעלו התראות', { duration: 4000 })
        return
      }

      if (!user) return
      await subscribeToPush(user.id)
      setSubscribed(true)
      toast.success('התראות הופעלו — תקבל/י עדכון כשהעמדה שלך עומדת להשתנות')
    } catch (error) {
      console.error('Failed to subscribe to push', error)
      toast.error('הפעלת ההתראות נכשלה. נסה שוב')
    } finally {
      setBusy(false)
    }
  }

  const active = permission === 'granted' && subscribed

  return (
    <button
      onClick={() => {
        void handleClick()
      }}
      disabled={busy}
      aria-label={active ? 'התראות פעילות' : 'הפעל התראות'}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
        active ? 'bg-primary-light text-primary' : 'bg-background text-text-secondary'
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        {permission === 'denied' && <line x1="3" y1="3" x2="21" y2="21" />}
      </svg>
    </button>
  )
}
