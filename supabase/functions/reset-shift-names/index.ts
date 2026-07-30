import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

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

type ShiftCategory = 'morning' | 'afternoon' | 'night'

function getActiveCategory(hour: number): ShiftCategory {
  if (hour >= 7 && hour < 15) return 'morning'
  if (hour >= 15 && hour < 23) return 'afternoon'
  return 'night'
}

function getIsraelHour(): number {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false })
  return Number(fmt.format(new Date()))
}

/** True if `names` has at least one guard actually filled in. */
function hasAnyName(guardNames: Record<string, { name: string; user_id: string | null }> | null): boolean {
  if (!guardNames) return false
  return Object.values(guardNames).some((assignment) => assignment?.name?.trim())
}

/**
 * Runs every few minutes: any board whose shift is no longer the active
 * category gets its guard_names wiped, so the next time someone opens that
 * shift it's blank instead of showing whoever worked it last time. Purely a
 * function of "is this shift active right now" — idempotent by construction,
 * no dedup table needed (clearing an already-empty board is a no-op).
 */
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

  const activeCategory = getActiveCategory(getIsraelHour())

  const { data: shiftTypes, error: shiftTypesError } = await adminClient.from('shift_types').select('id, category')
  if (shiftTypesError) return jsonResponse({ error: shiftTypesError.message }, 500)

  const categoryByShiftId: Record<string, ShiftCategory> = {}
  for (const s of shiftTypes ?? []) categoryByShiftId[s.id] = s.category as ShiftCategory

  const { data: boards, error } = await adminClient.from('roster_boards').select('id, shift_id, guard_names')
  if (error) return jsonResponse({ error: error.message }, 500)

  let checked = 0
  let reset = 0

  for (const board of boards ?? []) {
    const category = categoryByShiftId[board.shift_id]
    if (!category || category === activeCategory) continue // still the live shift, or unknown shift_id — leave alone

    checked++
    if (!hasAnyName(board.guard_names)) continue // already blank

    const { error: updateError } = await adminClient
      .from('roster_boards')
      .update({ guard_names: {} })
      .eq('id', board.id)

    if (updateError) {
      console.error('failed to reset guard_names', board.id, updateError)
      continue
    }
    reset++
  }

  return jsonResponse({ activeCategory, checked, reset }, 200)
})
