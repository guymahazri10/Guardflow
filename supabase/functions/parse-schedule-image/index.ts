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

// Pinned to a specific model id rather than an alias like "gemini-flash-
// latest": that alias 503'd repeatedly in manual testing while the pinned
// id responded normally, and a pinned id fails predictably (loud 404) if
// Google retires it, rather than silently drifting behavior. Verified
// directly against the Gemini API on 2026-09-01 — "gemini-2.0-flash" (the
// model this function originally shipped with) no longer exists, and
// "gemini-2.5-flash" now 404s with "no longer available to new users" for
// this API key. Revisit this constant if requests start failing again.
const GEMINI_MODEL = 'gemini-3.6-flash'

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
4. שורת עמדה — התא הראשון הוא שם העמדה/תפקיד כפי שכתוב בתמונה. שאר התאים
   הם התוכן בפועל של אותו יום עבור אותה עמדה.
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

async function callGemini(apiKey: string, base64Data: string, mimeType: string): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    console.error('parse-schedule-image: Gemini call failed:', error instanceof Error ? error.message : error)
    return jsonResponse(
      { supported: false, reason: 'קריאת התמונה נכשלה. נסה שוב, או השתמש בקובץ Excel אם זמין.' },
      200,
    )
  }

  if (!result.supported || !result.rows || result.rows.length === 0) {
    return jsonResponse(
      { supported: false, reason: result.reason || 'לא זוהה טקסט קריא בתמונה.' },
      200,
    )
  }

  const grid = {
    rows: result.rows.map((row) =>
      row.map((cellText) => ({
        text: cellText,
        entries: cellText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      })),
    ),
  }

  const warnings = (result.warnings ?? []).map((message) => ({ kind: 'low_confidence_ocr', message }))

  return jsonResponse({ supported: true, grid, warnings }, 200)
})
