import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import type { ParseResult, RawGrid, ValidationWarning } from './types'

/**
 * OCR/table-extraction runs server-side, in the parse-schedule-image edge
 * function, which sends each image to the Gemini API and asks it to return
 * the schedule table directly as structured JSON. This replaced an earlier
 * client-side tesseract.js + geometric-clustering approach: that pipeline
 * (word-level OCR bounding boxes reconstructed into a grid via row/column
 * proximity heuristics) proved too fragile on real screenshots — even after
 * recalibrating its row/column tolerances against real bounding-box data,
 * it still produced garbage cells (misread text, 0 assignments recognized)
 * on the denser sections of a real mishmarot.co.il screenshot. Asking a
 * vision model to read the table directly avoids that whole class of bug.
 * See docs/superpowers/specs/2026-09-01-image-schedule-import-design.md for
 * the original tesseract.js design and why the earlier approach was chosen
 * (Deno edge runtime couldn't boot tesseract.js at all) — Gemini's
 * server-side HTTPS API call has no such constraint.
 */

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function getFunctionErrorMessage(error: Error): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // fall through to generic message below
    }
  }
  return error.message || 'קריאת התמונה נכשלה.'
}

type ImageParseResponse =
  | { supported: true; grid: RawGrid; warnings?: ValidationWarning[] }
  | { supported: false; reason: string }

async function parseOneImage(bytes: Uint8Array, mimeType: string): Promise<ImageParseResponse> {
  const imageBase64 = bytesToBase64(bytes)
  const { data, error } = await supabase.functions.invoke('parse-schedule-image', {
    body: { imageBase64, mimeType },
  })

  if (error) {
    return { supported: false, reason: await getFunctionErrorMessage(error) }
  }

  return data as ImageParseResponse
}

function mergeGrids(grids: RawGrid[]): RawGrid {
  if (grids.length === 0) return { rows: [] }
  const [first, ...rest] = grids
  const rows = [...first.rows]
  for (const g of rest) {
    rows.push(...g.rows.slice(1))
  }
  return { rows }
}

export async function parseImageSchedule(
  images: Uint8Array[],
  onProgress?: (info: { imageIndex: number; totalImages: number; progress: number }) => void,
  mimeTypes: string[] = [],
): Promise<ParseResult> {
  if (images.length === 0) {
    return { supported: false, reason: 'לא נבחרו תמונות.' }
  }

  const grids: RawGrid[] = []
  const allWarnings: ValidationWarning[] = []

  for (let i = 0; i < images.length; i++) {
    onProgress?.({ imageIndex: i, totalImages: images.length, progress: 0 })
    const mimeType = mimeTypes[i] ?? 'image/png'
    const result = await parseOneImage(images[i], mimeType)
    onProgress?.({ imageIndex: i, totalImages: images.length, progress: 1 })

    if (!result.supported) {
      return result
    }
    grids.push(result.grid)
    allWarnings.push(...(result.warnings ?? []))
  }

  const merged = mergeGrids(grids)

  if (merged.rows.length === 0) {
    return {
      supported: false,
      reason: 'לא זוהה טקסט קריא בתמונה. יש לוודא שהתמונה ברורה וכוללת את הלוז המלא.',
    }
  }

  return { supported: true, grid: merged, warnings: allWarnings }
}
