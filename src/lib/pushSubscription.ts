import { supabase } from './supabase'
import { VAPID_PUBLIC_KEY } from '../constants/push'

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  return navigator.serviceWorker.register('/sw.js')
}

/** True if this browser already holds an active push subscription. */
export async function hasActivePushSubscription(): Promise<boolean> {
  const registration = await getRegistration()
  if (!registration) return false
  const existing = await registration.pushManager.getSubscription()
  return !!existing
}

/** Subscribes this device to Web Push and saves it so the server can reach it. */
export async function subscribeToPush(userId: string): Promise<void> {
  const registration = await getRegistration()
  if (!registration) throw new Error('הדפדפן הזה לא תומך בהתראות push')

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    })
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('הרשמה להתראות נכשלה')
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw error
}
