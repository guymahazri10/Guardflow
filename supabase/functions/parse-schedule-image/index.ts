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
 * Mirrors supabase/functions/parse-schedule/index.ts — kept in sync by hand
 * since Deno edge functions cannot import from a shared src/ module.
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

// A *lite* model, chosen on measured latency, not capability guesswork. The
// full "gemini-3.6-flash" is a thinking model: timed against the real
// mishmarot.co.il screenshot it burned 5058 thinking tokens to produce 1372
// tokens of answer and took 211 SECONDS — far past the edge runtime's
// wall-clock limit, so the worker was killed mid-flight (observed live as an
// "EarlyDrop" shutdown ~75s in, and surfaced to the manager as the useless
// "Edge Function returned a non-2xx status code"). The lite model returned
// equal-or-better extraction on the same image in 5.6s.
//
// An alias rather than a pinned id, deliberately: two pinned ids have
// already been retired out from under this function ("gemini-2.0-flash" is
// gone, "gemini-2.5-flash" now 404s as "no longer available to new users"),
// and a hard 404 in an app nobody is monitoring is worse than the alias's
// risk of behavior drift — this function no longer depends on the model's
// exact text formatting, only on the declared JSON schema.
const GEMINI_MODEL = 'gemini-flash-lite-latest'

// Latency is unstable even on the lite model: the same image measured 5.6s,
// 6.2s, 42.3s and 75.7s across runs. Rather than let a slow roll of the dice
// get the whole worker killed (which loses the request with no usable error),
// bound each attempt and retry once — a retry usually lands in the fast case.
// Worst case stays comfortably under the wall-clock limit that killed us.
const GEMINI_TIMEOUT_MS = 25_000
const GEMINI_MAX_ATTEMPTS = 2

/**
 * Asks for finished assignment records rather than a picture of the table.
 *
 * The previous version asked for a 2D grid of cell strings, which the client
 * then re-parsed back into structure — and every import bug so far lived in
 * that re-parsing, never in the model's reading. Requesting the fields
 * separately (a real ISO date, a position from a closed list, start and end
 * as HH:MM, the name on its own) removes the ambiguity the grid reintroduced.
 */
function buildPrompt(positionsBlock: string, today: string): string {
  return `אתה מנתח טבלת סידור עבודה שבועי מצילום מסך של מערכת משמרות.

החזר אך ורק JSON תואם לסכימה שסופקה. אל תוסיף טקסט מחוץ ל-JSON.

המשימה: החזר רשימה שטוחה של כל השיבוצים בטבלה. כל שיבוץ הוא רשומה אחת —
עובד אחד, ביום אחד, בעמדה אחת. אל תחזיר טבלה או רשת; רק רשימת רשומות.

כללים קפדניים:

1. כלול אך ורק שיבוצים מהסעיפים "אחמ"ש" ו"מאבטח".
   התעלם לחלוטין מכל סעיף אחר — בקרה, היעדרויות, חופש, מחלה, מילואים,
   קורס, לימודים, תגבור. אל תחזיר את השורות שלהם כלל.

2. שדה date: התאריך המלא בפורמט YYYY-MM-DD. הסק אותו מכותרת העמודה
   בתמונה. שים לב שהתאריכים בכותרת עשויים להיכתב בצורות שונות, למשל
   "30\\8" או "30/8" — פענח אותם לתאריך מלא. היום הוא ${today},
   והסידור הוא לשבוע קרוב לתאריך הזה — קבע את השנה בהתאם.

3. שדה worker_kind: בדיוק אחד משני הערכים: "אחמ"ש" או "מאבטח".

4. שדה position: בחר בדיוק אחד מהערכים המותרים לאותו worker_kind מהרשימה
   הבאה. אל תמציא ערכים חדשים ואל תוסיף שעות או תאריכים לשם העמדה:
${positionsBlock}
   שים לב: התווית בתמונה עשויה לכלול תוספות שאינן חלק מהעמדה עצמה —
   שם המשמרת ("בוקר"/"צהריים"/"לילה") ומילים כמו "חמוש". התעלם מהן
   והחזר רק את שם העמדה הבסיסי מהרשימה. לדוגמה: שורה שכותרתה "אחמ"ש
   בוקר" מקבלת position="אחמ"ש" (בלי "בוקר" — התאריך והשעות כבר
   מבטאים את פרק הזמן), ושורה שכותרתה "לובי עליון - חמוש" מקבלת
   position="לובי עליון" (בלי "- חמוש").
   אם שורה בתמונה לא מתאימה לאף אחת מהעמדות האלה — דלג עליה, והוסף
   הסבר קצר למערך warnings.

5. שדות start ו-end: השעות בפועל של אותו תא, בפורמט HH:MM כל אחד
   (למשל start="06:30", end="15:00"). קרא את השעות הכתובות בתא עצמו —
   אל תשתמש בברירת מחדל של השורה או של הקטגוריה. משמרות חריגות קיימות
   (למשל 06:30-19:00 או 14:45-18:30) והן חייבות להישמר כפי שהן.

6. שדה name: שם העובד בלבד, בלי שעות ובלי תווים נוספים.

7. אם באותו תא מופיעים כמה עובדים, החזר רשומה נפרדת לכל עובד — עם אותו
   date, position ו-worker_kind, ועם השעות של אותו עובד.

8. תא ריק (בלי שם עובד) — אל תחזיר עבורו רשומה כלל.

9. חשוב מאוד: גם אם התמונה חתוכה, מטושטשת או חלקית — החזר supported=true
   ואת כל השיבוצים שכן קריאים. חיתוך או חוסר אינם סיבה להימנע מהחזרת
   נתונים. הוסף ל-warnings תיאור מפורש של מה חסר או לא ודאי (למשל אילו
   שורות או ימים חתוכים).

10. החזר supported=false אך ורק אם התמונה אינה טבלת סידור עבודה כלל —
    למשל צילום של משהו אחר לגמרי. טבלה חתוכה, חלקית או מטושטשת היא עדיין
    טבלת סידור, ועבורה supported=true תמיד.`
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supported: { type: 'BOOLEAN' },
    reason: { type: 'STRING' },
    assignments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          worker_kind: { type: 'STRING' },
          position: { type: 'STRING' },
          start: { type: 'STRING' },
          end: { type: 'STRING' },
          name: { type: 'STRING' },
        },
        required: ['date', 'worker_kind', 'position', 'start', 'end', 'name'],
      },
    },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['supported'],
}

type GeminiResult = {
  supported: boolean
  reason?: string
  assignments?: unknown[]
  warnings?: string[]
}

async function callGeminiOnce(
  apiKey: string,
  base64Data: string,
  mimeType: string,
  prompt: string,
): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  // Deno's fetch has no built-in timeout — without this the request can hang
  // long enough for the platform to kill the whole worker, which loses the
  // response entirely instead of producing an error we can report.
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), GEMINI_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Gemini API request failed (${response.status}): ${text.slice(0, 500)}`)
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof text !== 'string') {
    throw new Error('Gemini API returned no text content')
  }

  return JSON.parse(text) as GeminiResult
}

async function callGemini(
  apiKey: string,
  base64Data: string,
  mimeType: string,
  prompt: string,
): Promise<GeminiResult> {
  let lastError: unknown
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    try {
      return await callGeminiOnce(apiKey, base64Data, mimeType, prompt)
    } catch (error) {
      lastError = error
      console.error(
        `parse-schedule-image: Gemini attempt ${attempt}/${GEMINI_MAX_ATTEMPTS} failed:`,
        error instanceof Error ? error.message : error,
      )
    }
  }
  throw lastError
}

/**
 * Renders the caller-supplied position list into the prompt.
 *
 * The list comes from the client (src/lib/scheduleImport/positions.ts) so it
 * has a single definition rather than being duplicated here, where an edge
 * function cannot import from src/. Values are sanitized before being
 * interpolated into the prompt: only a manager can reach this function and
 * the content only shapes extraction of their own image, but text that goes
 * into a prompt should never carry newlines that could restructure it.
 */
function buildPositionsBlock(positions: unknown): string | null {
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) return null

  const lines: string[] = []
  for (const [workerKind, list] of Object.entries(positions as Record<string, unknown>)) {
    if (!Array.isArray(list) || list.length === 0) return null
    const clean = list
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => p.length > 0 && p.length <= 60)
    if (clean.length === 0) return null
    const kind = String(workerKind).replace(/\s+/g, ' ').trim().slice(0, 40)
    lines.push(`   - ${kind}: ${clean.map((p) => `"${p}"`).join(', ')}`)
  }

  return lines.length > 0 ? lines.join('\n') : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const auth = await requireManager(req)
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status)
  }

  let body: { imageBase64?: unknown; mimeType?: unknown; positions?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
  if (!imageBase64 || !mimeType) {
    return jsonResponse({ error: 'imageBase64 and mimeType are required' }, 400)
  }

  const positionsBlock = buildPositionsBlock(body.positions)
  if (!positionsBlock) {
    return jsonResponse({ error: 'positions is required' }, 400)
  }

  const { adminClient } = auth
  const { data: apiKey } = await adminClient.rpc('get_app_secret', { secret_name: 'gemini_api_key' })
  if (!apiKey) {
    return jsonResponse({ error: 'Gemini API key not configured' }, 500)
  }

  let result: GeminiResult
  try {
    // Only a hint — the client re-derives the year deterministically from the
    // day/month (normalizeExtracted.ts's anchorYear), because the source
    // table's headers carry no year at all and the model otherwise guesses
    // (it returned 2024 for a 2026 schedule).
    const today = new Date().toISOString().slice(0, 10)
    result = await callGemini(apiKey, imageBase64, mimeType, buildPrompt(positionsBlock, today))
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    return jsonResponse(
      {
        supported: false,
        reason: timedOut
          ? 'שירות קריאת התמונה איטי כרגע ולא הספיק להשיב. נסה שוב בעוד רגע.'
          : 'קריאת התמונה נכשלה. נסה שוב, או השתמש בקובץ Excel אם זמין.',
      },
      200,
    )
  }

  if (!result.supported || !Array.isArray(result.assignments) || result.assignments.length === 0) {
    return jsonResponse(
      { supported: false, reason: result.reason || 'לא זוהו שיבוצים בתמונה.' },
      200,
    )
  }

  // Field-level validation happens client-side (normalizeExtracted.ts), which
  // owns the canonical position list and produces the Hebrew warnings shown in
  // the preview. This only guarantees the shape is what the client expects.
  const assignments = result.assignments.filter(
    (a): a is Record<string, unknown> => !!a && typeof a === 'object' && !Array.isArray(a),
  )

  return jsonResponse(
    { supported: true, assignments, warnings: result.warnings ?? [] },
    200,
  )
})
