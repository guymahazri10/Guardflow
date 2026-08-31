import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs'

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

type TextItem = { str: string; transform: number[] }

/**
 * Groups extracted PDF text items into rows by their y-coordinate (rounded
 * to a 5-unit bucket to tolerate small baseline jitter within a row), then
 * sorts each row left-to-right by x-coordinate. Mirrors the grid-extraction
 * half of src/lib/scheduleImport/parsePdfSchedule.ts — kept in sync by hand
 * since Deno edge functions cannot import from src/. The allowlist/matching/
 * validation logic is NOT duplicated here; it stays client-side and runs on
 * the grid this function returns.
 */
function clusterIntoGrid(items: TextItem[]) {
  const rowsByY = new Map<number, TextItem[]>()
  for (const item of items) {
    const y = Math.round(item.transform[5] / 5) * 5
    const bucket = rowsByY.get(y) ?? []
    bucket.push(item)
    rowsByY.set(y, bucket)
  }
  const sortedYs = Array.from(rowsByY.keys()).sort((a, b) => b - a)
  return sortedYs.map((y) => {
    const rowItems = rowsByY.get(y)!.sort((a, b) => a.transform[4] - b.transform[4])
    return rowItems.map((item) => ({ text: item.str.trim(), entries: [item.str.trim()] }))
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const auth = await requireManager(req)
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status)
  }

  let body: { storagePath?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : ''
  if (!storagePath) {
    return jsonResponse({ error: 'storagePath is required' }, 400)
  }

  const { adminClient } = auth

  const { data: fileData, error: downloadError } = await adminClient.storage
    .from('schedule-imports')
    .download(storagePath)

  if (downloadError || !fileData) {
    return jsonResponse({ error: 'Failed to download file' }, 404)
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer())

  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const pdf = await loadingTask.promise
  const allItems: TextItem[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    for (const item of textContent.items as TextItem[]) {
      if (item.str && item.str.trim()) allItems.push(item)
    }
  }

  if (allItems.length < 4) {
    return jsonResponse({ supported: false, reason: 'קובץ PDF סרוק — לא נתמך בשלב זה.' }, 200)
  }

  const grid = clusterIntoGrid(allItems)

  return jsonResponse({ supported: true, grid }, 200)
})
