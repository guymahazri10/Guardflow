import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import type { ValidationWarning } from './types'
import type { ExtractedAssignment } from './normalizeExtracted'
import { CANONICAL_POSITIONS } from './positions'

/**
 * Image import asks the parse-schedule-image edge function (Gemini) for the
 * finished assignment records directly — not for a picture of the table.
 *
 * The earlier design had the model reproduce a 2D grid of cell strings, which
 * this file then re-parsed back into structure. Every import bug so far lived
 * in that re-parsing: a backslash date separator the header regex rejected, a
 * newline where a space was expected inside a cell, section rows that didn't
 * match the expected shape. The model had read the table correctly in every
 * one of those cases; the grid was a lossy intermediate that threw the
 * structure away and forced it to be guessed back. Asking for structured
 * records removes that whole class of failure.
 *
 * The canonical position list travels with the request so it is defined in
 * exactly one place (positions.ts) rather than being duplicated into the edge
 * function, which cannot import from src/.
 */

export type ImageParseResult =
  | { supported: true; assignments: ExtractedAssignment[]; warnings: ValidationWarning[] }
  | { supported: false; reason: string }

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked because String.fromCharCode(...bytes) blows the argument limit on
  // a multi-megabyte screenshot.
  const CHUNK_SIZE = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

async function getFunctionErrorMessage(error: Error): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // fall through to the generic message below
    }
  }
  return error.message || 'קריאת התמונה נכשלה.'
}

type FunctionResponse =
  | { supported: true; assignments?: ExtractedAssignment[]; warnings?: string[] }
  | { supported: false; reason: string }

async function parseOneImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ImageParseResult> {
  const { data, error } = await supabase.functions.invoke('parse-schedule-image', {
    body: {
      imageBase64: bytesToBase64(bytes),
      mimeType,
      positions: CANONICAL_POSITIONS,
    },
  })

  if (error) {
    return { supported: false, reason: await getFunctionErrorMessage(error) }
  }

  const response = data as FunctionResponse
  if (!response?.supported) {
    return { supported: false, reason: response?.reason ?? 'קריאת התמונה נכשלה.' }
  }

  return {
    supported: true,
    assignments: response.assignments ?? [],
    warnings: (response.warnings ?? []).map((message) => ({
      kind: 'low_confidence_ocr' as const,
      message,
    })),
  }
}

export async function parseImageSchedule(
  images: Uint8Array[],
  onProgress?: (info: { imageIndex: number; totalImages: number; progress: number }) => void,
  mimeTypes: string[] = [],
): Promise<ImageParseResult> {
  if (images.length === 0) {
    return { supported: false, reason: 'לא נבחרו תמונות.' }
  }

  const allAssignments: ExtractedAssignment[] = []
  const allWarnings: ValidationWarning[] = []

  for (let i = 0; i < images.length; i++) {
    onProgress?.({ imageIndex: i, totalImages: images.length, progress: 0 })
    const result = await parseOneImage(images[i], mimeTypes[i] ?? 'image/png')
    onProgress?.({ imageIndex: i, totalImages: images.length, progress: 1 })

    if (!result.supported) return result

    // Multiple images are different slices of the same week, so their records
    // simply concatenate — no header row to reconcile, unlike the old grid
    // merge which had to decide which image's header won.
    allAssignments.push(...result.assignments)
    allWarnings.push(...result.warnings)
  }

  if (allAssignments.length === 0) {
    return {
      supported: false,
      reason: 'לא זוהו שיבוצים בתמונה. יש לוודא שהתמונה ברורה וכוללת את הטבלה המלאה.',
    }
  }

  return { supported: true, assignments: allAssignments, warnings: allWarnings }
}
