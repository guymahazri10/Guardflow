import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/* ─── Shift-time helpers, mirrored from src/lib/shiftBlocks.ts + src/constants/shifts.ts ─── */

type ShiftCategory = 'morning' | 'afternoon' | 'night'

const SHIFT_IDS_BY_CATEGORY: Record<ShiftCategory, string[]> = {
  morning: ['morning_6', 'morning_5'],
  afternoon: ['afternoon_4', 'afternoon_3'],
  night: ['night'],
}

const NOTIFY_WINDOW_MINUTES = 5

function getActiveCategory(hour: number): ShiftCategory {
  if (hour >= 7 && hour < 15) return 'morning'
  if (hour >= 15 && hour < 23) return 'afternoon'
  return 'night'
}

/** Current hour/minute in Israel local time, DST-aware (server runs in UTC). */
function getIsraelNow(): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')!.value)
  const minute = Number(parts.find((p) => p.type === 'minute')!.value)
  return { hour, minute }
}

function toShiftMinutes(timeStr: string, isNight: boolean): number {
  const [h, m] = timeStr.split(':').map(Number)
  const mins = h * 60 + m
  if (isNight && h <= 7) return mins + 24 * 60
  return mins
}

type RosterBoardRow = { time: string; cells: Record<string, string> }

function getCurrentBlock(rows: RosterBoardRow[], nowMins: number, isNight: boolean): RosterBoardRow | null {
  if (!rows?.length) return null
  let current: RosterBoardRow | null = null
  for (const row of rows) {
    if (toShiftMinutes(row.time, isNight) <= nowMins) current = row
  }
  return current ?? rows[0]
}

function getNextBlock(rows: RosterBoardRow[], current: RosterBoardRow | null, isNight: boolean): RosterBoardRow | null {
  if (!rows?.length || !current) return null
  const sorted = [...rows].sort((a, b) => toShiftMinutes(a.time, isNight) - toShiftMinutes(b.time, isNight))
  const idx = sorted.findIndex((row) => row.time === current.time)
  if (idx === -1 || idx === sorted.length - 1) return null
  return sorted[idx + 1]
}

/* ─── Main ─── */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: cronSecret } = await adminClient.rpc('get_app_secret', { secret_name: 'cron_shared_secret' })
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const { data: vapidPublic } = await adminClient.rpc('get_app_secret', { secret_name: 'vapid_public_key' })
  const { data: vapidPrivate } = await adminClient.rpc('get_app_secret', { secret_name: 'vapid_private_key' })
  if (!vapidPublic || !vapidPrivate) {
    return jsonResponse({ error: 'VAPID keys not configured' }, 500)
  }
  webpush.setVapidDetails('mailto:guy97735@gmail.com', vapidPublic, vapidPrivate)

  const { hour, minute } = getIsraelNow()
  const nowMins = hour * 60 + minute
  const category = getActiveCategory(hour)
  const isNight = category === 'night'
  const shiftIds = SHIFT_IDS_BY_CATEGORY[category]

  const { data: board, error: boardError } = await adminClient
    .from('roster_boards')
    .select('*')
    .eq('published', true)
    .in('shift_id', shiftIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (boardError) return jsonResponse({ error: boardError.message }, 500)
  if (!board) return jsonResponse({ checked: 0, sent: 0, reason: 'no active published board' }, 200)

  // isNight-aware "now": mirrors client's nowAsShiftMinutes (wraps 0-7h to 24-31h for night boards).
  const nowShiftMins = isNight && hour <= 7 ? nowMins + 24 * 60 : nowMins

  const rows: RosterBoardRow[] = board.rows ?? []
  const currentBlock = getCurrentBlock(rows, nowShiftMins, isNight)
  const nextBlock = getNextBlock(rows, currentBlock, isNight)

  let sent = 0
  let checked = 0

  if (currentBlock && nextBlock) {
    const minutesUntil = toShiftMinutes(nextBlock.time, isNight) - nowShiftMins

    if (minutesUntil >= 0 && minutesUntil <= NOTIFY_WINDOW_MINUTES) {
      const guardNames = (board.guard_names ?? {}) as Record<string, { name: string; user_id: string | null }>

      for (const col of board.cols ?? []) {
        const assignment = guardNames[col]
        if (!assignment?.user_id) continue

        const currentTask = currentBlock.cells?.[col]
        const nextTask = nextBlock.cells?.[col]
        if (!nextTask || nextTask === currentTask) continue

        checked++
        const notifyKey = `${board.id}:${nextBlock.time}:${col}`

        const { data: inserted } = await adminClient
          .from('push_notification_log')
          .upsert({ user_id: assignment.user_id, notify_key: notifyKey }, { onConflict: 'user_id,notify_key', ignoreDuplicates: true })
          .select()

        if (!inserted || inserted.length === 0) continue // already notified for this transition

        const { data: subs } = await adminClient
          .from('push_subscriptions')
          .select('*')
          .eq('user_id', assignment.user_id)

        const title = '⚠️ שינוי עמדה קרוב'
        const body = `בעוד ${Math.max(minutesUntil, 0)} דקות עובר/ת לעמדה: ${nextTask}`
        const payload = JSON.stringify({ title, body, tag: notifyKey })

        for (const sub of subs ?? []) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
            )
            sent++
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) {
              await adminClient.from('push_subscriptions').delete().eq('id', sub.id)
            } else {
              console.error('push send failed', sub.id, err)
            }
          }
        }
      }
    }
  }

  return jsonResponse({ checked, sent }, 200)
})
