import type { ParseResult } from './types'

/**
 * Phase-1 stub. Image/camera-capture import requires OCR or a Vision API,
 * which is a paid external dependency not present in this project and not
 * approved for this phase (see design spec "Open questions"). This function
 * exists so the UI and pipeline shape are already correct; phase 2 replaces
 * only this function's body.
 */
export async function parseImageSchedule(images: Uint8Array[]): Promise<ParseResult> {
  void images
  return {
    supported: false,
    reason: 'ייבוא מתמונה אינו נתמך עדיין בשלב זה. יש להעלות כקובץ Excel או PDF עם טקסט.',
  }
}
