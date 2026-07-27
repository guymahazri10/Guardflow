import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type ManagerCheckResult =
  | { ok: true; caller: User; adminClient: SupabaseClient }
  | { ok: false; status: number; error: string }

/**
 * Verifies the request carries a valid session belonging to a מנהל.
 * Returns a service-role client for the caller to use once authorized.
 */
async function requireManager(req: Request): Promise<ManagerCheckResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return { ok: false, status: 401, error: 'Missing authorization header' }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser()

  if (callerError || !caller) {
    return { ok: false, status: 401, error: 'Invalid session' }
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('app_role')
    .eq('id', caller.id)
    .maybeSingle()

  if (profileError || callerProfile?.app_role !== 'מנהל') {
    return { ok: false, status: 403, error: 'Not authorized' }
  }

  return { ok: true, caller, adminClient }
}

const VALID_ROLES = ['מנהל', 'אחמ"ש', 'מאבטח']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const auth = await requireManager(req)
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status)
  }

  let body: { email?: unknown; fullName?: unknown; role?: unknown; redirectTo?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  // Lowercased: Supabase always stores auth.users.email lowercase, and the
  // allow-list trigger compares against pending_invites.email exactly — a
  // mixed-case address here would insert fine but never match at signup.
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const role = typeof body.role === 'string' ? body.role : ''
  const redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : undefined

  if (!email || !VALID_ROLES.includes(role)) {
    return jsonResponse({ error: 'Invalid email or role' }, 400)
  }

  const { adminClient, caller } = auth

  // Allow-list this email *before* creating the auth user: a BEFORE INSERT
  // trigger on auth.users checks pending_invites and rejects anyone who
  // isn't in it — including this very call, so the order matters. This also
  // lets an invited user sign in with Google instead of setting a password;
  // an AFTER INSERT trigger picks the role back up from here in that case.
  const { error: pendingError } = await adminClient
    .from('pending_invites')
    .upsert({ email, app_role: role, full_name: fullName || null, invited_by: caller.id }, { onConflict: 'email' })

  if (pendingError) {
    return jsonResponse({ error: pendingError.message }, 500)
  }

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: fullName ? { full_name: fullName } : undefined,
    redirectTo,
  })

  if (inviteError || !invited?.user) {
    await adminClient.from('pending_invites').delete().eq('email', email)
    return jsonResponse({ error: inviteError?.message ?? 'Failed to invite user' }, 400)
  }

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ app_role: role, full_name: fullName || null })
    .eq('id', invited.user.id)

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500)
  }

  // The AFTER INSERT trigger already consumed/deleted the pending_invites
  // row for this normal (admin-creates-then-user-sets-password) path — this
  // is just a safety net in case that ever changes.
  await adminClient.from('pending_invites').delete().eq('email', email)

  return jsonResponse({ id: invited.user.id, email: invited.user.email }, 200)
})
