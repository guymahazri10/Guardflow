# Image schedule import (client-side OCR) — design spec

**Date:** 2026-09-01
**Status:** approved
**Branch:** `main` (small addition to the shipped weekly-schedule-import feature)

## Problem

The weekly-schedule-import feature (shipped 2026-08-31) supports Excel upload; `parseImageSchedule` is a permanent phase-1 stub. The user's actual source system (`mishmarot.co.il`) offers no Excel/PDF export — only screenshots of its web table. This spec fills in `parseImageSchedule` for real, using the same pipeline (`normalizeSchedule` → `matchNames` → `validateSchedule`) already built and tested.

## Spike: server-side OCR ruled out

`tesseract.js` (all import variants: `npm:`, `esm.sh` default, `esm.sh?target=denonext`) fails to boot in Supabase's Deno edge runtime — `Worker.prototype.constructor` is `Not implemented`, because tesseract.js's environment detection always resolves to its Node `worker_threads` spawn path under Deno, which Deno's Node-compat layer doesn't implement. Confirmed live against the local edge runtime (`supabase-edge-runtime-1.74.3`, Deno v2.1.4). Unlike the earlier `pdfjs-dist` blocker, no edge/serverless-compatible OCR drop-in was identified. **Decision: OCR runs client-side, in the manager's browser**, using tesseract.js's real browser build (genuine Web Workers, which every modern browser supports).

## Scope

In scope: screenshot images (PNG/JPEG) of a cleanly-rendered web table, 1 or more per upload, confidence-gated extraction feeding the existing pipeline unchanged.

Explicitly deferred (not this pass): image rotation controls, HEIC handling, direct camera capture. All three are real requirements from the original spec's "phase 2" language but aren't needed for the confirmed use case (screenshots, already correctly oriented, standard formats). Add them in a follow-up if a camera-capture use case materializes.

## Architecture

`src/lib/scheduleImport/parseImageSchedule.ts` (replaces the stub):

```typescript
export async function parseImageSchedule(images: Uint8Array[]): Promise<ParseResult>
```

For each image: runs `tesseract.js`'s `recognize()` (Hebrew + English trained data — the schedule mixes Hebrew names/labels with numeric times), producing per-word text, bounding box, and confidence. A 2D clustering pass reconstructs the grid:

1. **Row bands**: cluster words by Y-coordinate into row bands (wider tolerance than the PDF clustering's 5-unit bucket, since browser-rendered screenshot text has more font-metric jitter — tuned empirically against a real sample).
2. **Column bands**: within each row band, cluster by X-coordinate into column bands aligned to the detected header row's day columns.
3. **Cell reconstruction**: within each (row, column) cell, sort the words top-to-bottom then left-to-right and join them into the single-line `"HH:MM-HH:MM name"` format `normalizeSchedule`'s existing `CELL_ENTRY_PATTERN` already parses — no changes needed to `normalizeSchedule.ts` itself.
4. **Confidence**: each reconstructed cell carries an aggregate confidence (mean of its words' OCR confidence). Cells below a threshold are flagged as unreadable rather than guessed.

Multiple images are processed independently (each through the full OCR → grid → `normalizeSchedule` chain) and their resulting `NormalizedAssignment[]` arrays are concatenated before `matchNames`/`validateSchedule` run once over the combined set — no cross-image grid stitching, which would be fragile.

### New warning kind

`ValidationWarning.kind` gains `'low_confidence_ocr'`, surfaced by `validateSchedule` for any assignment whose source cell fell below the confidence threshold, alongside the existing `unmatched_name`/`duplicate_slot`/`conflict_with_existing`. Rendered in `SchedulePreview` exactly like the existing warnings.

## UI changes

`ScheduleImportPage.tsx`: the file input's `accept` gains `,image/png,image/jpeg`, and gains `multiple` (Excel/PDF stay single-file; images allow several). Selected images render as thumbnails with a per-image remove button before processing starts (matches the existing warnings-before-commit pattern). A progress indicator drives off tesseract.js's `logger` callback (percentage per image) — OCR takes several seconds per image, and the wizard must not look frozen.

## Storage

`schedule-imports` bucket's `allowed_mime_types` gains `image/png`, `image/jpeg`.

## Testing

Synthetic test fixtures: a small in-memory raster with known text, run through the real tesseract.js in a Vitest environment where feasible, or a mocked word-list matching the shape the real API returns (mirroring how Task 7's `parsePdfSchedule.test.ts` mocked `pdfjs-dist`) — covering: single clean image, a low-confidence cell correctly flagged (not silently dropped), and multiple images correctly concatenating into one combined assignment set before `validateSchedule`.
