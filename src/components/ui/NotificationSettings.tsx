import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  hasActivePushSubscription,
  needsHomeScreenInstall,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/pushSubscription'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

function readPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/**
 * Settings card for position-change alerts. Lives on the profile page instead of as a
 * bell in the live-screen header: it is a one-time setup, not something to act on every
 * glance. Enabling must stay behind an explicit click — browsers increasingly ignore or
 * auto-mute a permission prompt that isn't tied to a real user gesture. Enabling also
 * registers a Web Push subscription, so the alert can arrive when the app isn't open.
 *
 * Turning alerts off removes this device's subscription. A browser-level "blocked" can't be
 * changed from inside the page (browsers don't allow re-asking), so that state explains
 * where to change it and offers a re-check.
 */
export function NotificationSettings() {
  const { user } = useAuth()
  const [permission, setPermission] = useState<PermissionState>(readPermission)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const installNeeded = needsHomeScreenInstall()

  useEffect(() => {
    setPermission(readPermission())
    hasActivePushSubscription()
      .then(setSubscribed)
      .catch(() => setSubscribed(false))
  }, [])

  async function subscribeNow(): Promise<boolean> {
    if (!user) return false
    await subscribeToPush(user.id)
    setSubscribed(true)
    toast.success('התראות הופעלו — תקבל/י עדכון כשהעמדה שלך עומדת להשתנות')
    return true
  }

  async function handleEnable() {
    if (busy || !user) return

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

      await subscribeNow()
    } catch (error) {
      console.error('Failed to subscribe to push', error)
      toast.error('הפעלת ההתראות נכשלה. נסה שוב')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable() {
    if (busy) return

    setBusy(true)
    try {
      await unsubscribeFromPush()
      setSubscribed(false)
      toast('ההתראות כובו במכשיר הזה')
    } catch (error) {
      console.error('Failed to unsubscribe from push', error)
      toast.error('כיבוי ההתראות נכשל. נסה שוב')
    } finally {
      setBusy(false)
    }
  }

  async function handleRecheck() {
    if (busy) return

    const current = readPermission()
    setPermission(current)
    if (current !== 'granted') {
      toast('ההתראות עדיין חסומות בדפדפן', { duration: 4000 })
      return
    }

    setBusy(true)
    try {
      await subscribeNow()
    } catch (error) {
      console.error('Failed to subscribe to push', error)
      toast.error('הפעלת ההתראות נכשלה. נסה שוב')
    } finally {
      setBusy(false)
    }
  }

  const active = permission === 'granted' && subscribed
  const blocked = permission === 'denied' && !installNeeded

  let description = 'קבל/י עדכון כמה דקות לפני שהעמדה שלך משתנה.'
  if (installNeeded) {
    description = 'באייפון ההתראות עובדות רק אחרי הוספת GuardFlow למסך הבית: כפתור השיתוף, "הוסף למסך הבית", ואז לפתוח מהאייקון שם.'
  } else if (permission === 'unsupported') {
    description = 'הדפדפן הזה לא תומך בהתראות.'
  } else if (blocked) {
    description = 'ההתראות חסומות בדפדפן. אפשר לשנות את זה רק משם:'
  }

  const canEnable = !installNeeded && !active && (permission === 'default' || permission === 'granted')

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-text-primary text-sm">התראה לפני שינוי עמדה</p>
          <p className="text-text-label text-xs mt-1 leading-relaxed">{description}</p>
        </div>

        <div aria-live="polite" className="shrink-0 flex flex-col items-end gap-2">
          {active && (
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-text-primary bg-good-light rounded-badge px-3 py-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-good" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              פעילות
            </span>
          )}
          {blocked && (
            <span className="inline-flex items-center text-sm font-bold text-danger bg-danger-light rounded-badge px-3 py-1.5">חסומות</span>
          )}
          {canEnable && (
            <button
              type="button"
              onClick={() => {
                void handleEnable()
              }}
              disabled={busy}
              className="btn-primary min-h-[44px] px-5"
            >
              {busy ? 'מפעיל…' : 'הפעל'}
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="mt-4 pt-4 border-t border-border flex justify-between items-center gap-3">
          <p className="text-text-label text-xs leading-relaxed">אפשר לכבות את ההתראות במכשיר הזה בכל רגע.</p>
          <button
            type="button"
            onClick={() => {
              void handleDisable()
            }}
            disabled={busy}
            className="btn-ghost min-h-[44px] shrink-0 disabled:opacity-40"
          >
            {busy ? 'מכבה…' : 'כבה'}
          </button>
        </div>
      )}

      {blocked && (
        <div className="mt-4 pt-4 border-t border-border">
          <ol className="list-decimal pr-5 text-text-label text-xs leading-relaxed space-y-1">
            <li>לחץ על סמל המנעול או ההגדרות ליד כתובת האתר.</li>
            <li>בחר "התראות" ואז "אפשר".</li>
            <li>חזור לכאן ולחץ על הכפתור למטה.</li>
          </ol>
          <button
            type="button"
            onClick={() => {
              void handleRecheck()
            }}
            disabled={busy}
            className="btn-ghost min-h-[44px] mt-3 disabled:opacity-40"
          >
            {busy ? 'בודק…' : 'בדקתי, נסה שוב'}
          </button>
        </div>
      )}
    </div>
  )
}
