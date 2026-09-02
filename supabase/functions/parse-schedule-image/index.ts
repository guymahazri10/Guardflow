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
// risk of behavior drift — the cell parsing below is written to absorb that
// drift rather than depend on one model's exact output formatting.
const GEMINI_MODEL = 'gemini-flash-lite-latest'

// Latency is unstable even on the lite model: the same image measured 5.6s,
// 6.2s, 42.3s and 75.7s across runs. Rather than let a slow roll of the dice
// get the whole worker killed (which loses the request with no usable error),
// bound each attempt and retry once — a retry usually lands in the fast case.
// Worst case stays comfortably under the wall-clock limit that killed us.
const GEMINI_TIMEOUT_MS = 25_000
const GEMINI_MAX_ATTEMPTS = 2

// Kept in close sync with the section/entry conventions
// src/lib/scheduleImport/normalizeSchedule.ts expects: row[0] is the label
// column (a section header like אחמ"ש/מאבטח with every other cell in that
// row empty, or a position label), other rows carry "HH:MM-HH:MM name"
// lines per cell (one line per worker in that slot). normalizeSchedule does
// its own EXCLUDED_SECTION_LABELS filtering, but asking Gemini to already
// omit those sections avoids wasting output tokens and avoids leaking
// unrelated categories into warnings/preview if the filter ever drifts.
const PROMPT = `אתה מנתח טבלת סידור עבודה שבועי מצילום מסך של מערכת מש"מרות.

החזר אך ורק JSON תואם לסכימה שסופקה. אל תוסיף טקסט מחוץ ל-JSON.

כללים קפדניים:
1. כלול אך ורק שורות ששייכות לסעיפים "אחמ"ש" ו"מאבטח". התעלם לחלוטין מכל סעיף אחר
   (למשל: בקרה, היעדרויות, חופש, מחלה, מילואים, קורס, לימודים, תגבור) — אל תכלול
   את השורות שלהם בפלט כלל.
2. rows[0] היא שורת הכותרת: התא הראשון הוא כותרת עמודת התפקיד/עמדה, והתאים
   הבאים הם תאריכי הימים כפי שמופיעים בתמונה (למשל "06/09" או שם יום בעברית).
3. שורת כותרת סעיף (אחמ"ש / מאבטח) — התא הראשון מכיל את שם הסעיף, וכל שאר
   התאים בשורה ריקים ("").
4. שורת עמדה — התא הראשון הוא שם העמדה/התפקיד בלבד, ללא שעות וללא תאריכים.
   לדוגמה: "לובי תחתון", "AB", "רכוב בוקר", "אחמ"ש בוקר". אם בתמונה מופיעות
   שעות לצד שם העמדה — השמט אותן משם העמדה. שאר התאים בשורה הם התוכן בפועל
   של אותו יום עבור אותה עמדה.
5. בכל תא נתונים, קרא את השעות בפועל כפי שמופיעות בתמונה (לא ברירת מחדל לפי
   קטגוריה) והחזר כל שיבוץ כשורת טקסט בפורמט המדויק: "HH:MM-HH:MM שם_עובד".
   אם יש כמה עובדים באותו תא (כמה משמרות/עמדות משנה), החזר כמה שורות בתוך
   אותו תא, כל אחת בשורה נפרדת (\\n).
6. אם תא ריק — החזר מחרוזת ריקה "".
7. אם התמונה לא ברורה מספיק כדי לקרוא אותה, או שהיא לא צילום מסך של סידור
   עבודה, החזר supported=false עם reason בעברית שמסביר למה.
8. אם יש תא שאתה לא בטוח לגבי תוכנו (קריאה מעורפלת/חלקית), עדיין נסה למלא
   אותו כמיטב יכולתך, אך הוסף אזהרה למערך warnings שמתארת את השורה/עמודה
   ולמה אתה לא בטוח.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supported: { type: 'BOOLEAN' },
    reason: { type: 'STRING' },
    rows: {
      type: 'ARRAY',
      items: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['supported'],
}

type GeminiResult = {
  supported: boolean
  reason?: string
  rows?: string[][]
  warnings?: string[]
}

async function callGeminiOnce(
  apiKey: string,
  base64Data: string,
  mimeType: string,
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
            parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: base64Data } }],
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

async function callGemini(apiKey: string, base64Data: string, mimeType: string): Promise<GeminiResult> {
  let lastError: unknown
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    try {
      return await callGeminiOnce(apiKey, base64Data, mimeType)
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
 * Splits one table cell's text into "HH:MM-HH:MM name" lines, the exact
 * format normalizeSchedule's CELL_ENTRY_PATTERN expects.
 *
 * Deliberately NOT a plain split on newlines. The prompt asks for one line
 * per worker, but models format the inside of a cell inconsistently: the
 * flash model returned "06:30-15:00 ניר כהן" (space) while the lite model
 * returns "06:30-15:00\nניר כהן" (newline between the time and the name).
 * Splitting on newlines turned every cell into a timeless name plus a
 * nameless time, neither of which matches the entry pattern — measured
 * against a real screenshot's output that produced 0 usable entries out of
 * 138. Anchoring on the time ranges instead and treating everything up to
 * the next time range as that entry's name yields 58/58 real data cells
 * parsed, and is immune to which separator the model happens to emit.
 */
const TIME_RANGE_PATTERN = /\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function splitCellIntoEntries(cellText: string): string[] {
  if (!cellText.trim()) return []

  const starts: number[] = []
  TIME_RANGE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TIME_RANGE_PATTERN.exec(cellText)) !== null) {
    starts.push(match.index)
  }

  // No time range at all — a header/label cell. Keep it as a single line so
  // normalizeSchedule can still read day headers and position labels off it.
  if (starts.length === 0) {
    const single = collapseWhitespace(cellText)
    return single ? [single] : []
  }

  const entries: string[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : cellText.length
    const entry = collapseWhitespace(cellText.slice(starts[i], end))
    if (entry) entries.push(entry)
  }
  return entries
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const auth = await requireManager(req)
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status)
  }

  let body: { imageBase64?: unknown; mimeType?: unknown }
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

  const { adminClient } = auth
  const { data: apiKey } = await adminClient.rpc('get_app_secret', { secret_name: 'gemini_api_key' })
  if (!apiKey) {
    return jsonResponse({ error: 'Gemini API key not configured' }, 500)
  }

  let result: GeminiResult
  try {
    result = await callGemini(apiKey, imageBase64, mimeType)
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

  if (!result.supported || !result.rows || result.rows.length === 0) {
    return jsonResponse(
      { supported: false, reason: result.reason || 'לא זוהה טקסט קריא בתמונה.' },
      200,
    )
  }

  // `text` is collapsed to a single line because normalizeSchedule reads it
  // directly for column 0 (the section/position label) and for the day
  // headers — a label arriving as "בוקר מאבטח\nלובי תחתון" would otherwise
  // carry a newline into shift_assignments.position, which is part of that
  // table's uniqueness key.
  const grid = {
    rows: result.rows.map((row) =>
      row.map((cellText) => ({
        text: collapseWhitespace(cellText),
        entries: splitCellIntoEntries(cellText),
      })),
    ),
  }

  const warnings = (result.warnings ?? []).map((message) => ({ kind: 'low_confidence_ocr', message }))

  return jsonResponse({ supported: true, grid, warnings }, 200)
})
