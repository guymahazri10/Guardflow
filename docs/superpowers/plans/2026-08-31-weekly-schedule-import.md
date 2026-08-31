# Weekly Schedule Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager upload a weekly Excel schedule, review a diffable preview, and publish it as dated staffing (`shift_assignments`) that feeds `ShiftLivePage` alongside — never replacing — the existing non-dated `roster_boards.guard_names` flow, gated behind a feature flag and built first against a local Supabase stack (Docker, via the Supabase CLI). PDF text-extraction (`parsePdfSchedule`, the `parse-schedule` edge function) is implemented and tested as part of this plan, but wiring it into the upload UI is deferred to a follow-up task pending an X-axis column-bucketing fix to the PDF grid-clustering — see the design spec's Open Questions.

**Architecture:** Pure, framework-free parser modules (`detectFileKind` → `parseExcelSchedule`/`parsePdfSchedule` → `normalizeSchedule` → `matchNames` → `validateSchedule`) produce a reviewable diff with zero side effects. Two `security definer` RPCs (`publish_schedule_import`, `replace_assignment_worker`) are the only write path into three new additive tables; RLS grants no other insert/update/delete on them. Excel parses client-side; PDF parses in a new edge function. The UI is a new admin-only route plus small, additive hooks into the existing `ShiftLivePage`/`useActiveBoard`, both no-ops when the feature flag is off.

**Tech Stack:** React 18 + TS + Vite (existing), `xlsx` (SheetJS) for real Excel workbooks, native `DOMParser` for HTML-as-`.xls`, `pdfjs-dist` for PDF text extraction, Supabase (Postgres + RLS + Realtime + Storage + Edge Functions, existing), Vitest (new) for unit tests.

**Spec:** [docs/superpowers/specs/2026-08-31-weekly-schedule-import-design.md](../specs/2026-08-31-weekly-schedule-import-design.md)

## Global Constraints

- All migrations are additive only — no `alter`/`drop` on any existing table (`roster_boards`, `profiles`, `shift_templates`, `shift_types`, etc.). (Spec: Data model)
- No paid external API/service may be added without separate explicit user sign-off. Phase 1 ships Excel + text-layer PDF only; image/OCR stays a stub. (Spec: Open questions)
- Every new table's client-facing writes go through `security definer` RPCs — no direct INSERT/UPDATE/DELETE policy on `shift_assignments` or `staffing_change_log` for any role. (Spec: RLS)
- Excluded sections (בקרה, היעדרויות, חופש, מחלה, מילואים, קורס, לימודים, תגבור) must never appear in parsed output, warnings, previews, or DB rows — filtered inside `normalizeSchedule`, before anything else sees them. (Spec: normalizeSchedule)
- Hours for each assignment come from the cell's own text, never assumed from category defaults; night shifts crossing midnight get `ends_at` on `work_date + 1`. (Spec: normalizeSchedule)
- Identity key `(work_date, shift_category, position, slot_index)` drives idempotent upsert; re-uploading an identical file (same `content_hash` + `week_start`) is a no-op. (Spec: Data model, publish_schedule_import)
- Rows with `is_manually_edited = true` are never overwritten by an import unless the manager explicitly resolves them as `revert_to_file`. (Spec: publish_schedule_import)
- The entire feature (route, admin card, Live-page dated view) is invisible unless `app_feature_flags.weekly_schedule_import` is enabled for the current user; with it off, `ShiftLivePage`/`useActiveBoard` behave byte-for-byte as today. (Spec: Client-side integration)
- All test fixtures are synthetic data clearly labeled as test data (e.g. `בדיקה־א׳`), never real personnel names. (Spec: Testing)
- Work happens against a **local Supabase stack (Docker via the Supabase CLI)**, not the production project, until the user explicitly approves promoting to production. The production project is not on a plan that supports Supabase preview branches (confirmed 2026-08-31: `create_branch` failed with `PaymentRequiredException`); local Docker replaces preview branches as the isolation mechanism per the user's explicit choice. (Spec: Safe rollout path; Ruling: see plan ledger)

---

## File Structure

```
supabase/
  phase20_schedule_import_schema.sql       # 3 new tables + app_feature_flags + indexes
  phase20b_schedule_import_rls.sql         # RLS policies (SELECT-only where applicable)
  phase20c_schedule_import_rpcs.sql        # publish_schedule_import, replace_assignment_worker
  phase20d_schedule_import_storage.sql     # private bucket + storage RLS
  functions/parse-schedule/index.ts        # edge function: PDF parsing entrypoint

src/lib/scheduleImport/
  types.ts               # RawGrid, NormalizedAssignment, ParseResult, etc.
  detectFileKind.ts
  detectFileKind.test.ts
  parseExcelSchedule.ts   # real xlsx + HTML-as-xls, converges on RawGrid
  parseExcelSchedule.test.ts
  parsePdfSchedule.ts
  parsePdfSchedule.test.ts
  parseImageSchedule.ts   # phase-1 stub
  parseImageSchedule.test.ts
  normalizeSchedule.ts
  normalizeSchedule.test.ts
  matchNames.ts
  matchNames.test.ts
  validateSchedule.ts
  validateSchedule.test.ts
  fixtures/               # synthetic .xlsx/.html/.pdf-text fixtures for tests

src/lib/
  scheduleImports.ts      # thin Supabase client wrapper: upload, list, call RPCs
  featureFlags.ts         # fetchFeatureFlag()

src/hooks/
  useFeatureFlag.ts
  useScheduleImport.ts    # react-query mutations wrapping scheduleImports.ts
  useShiftAssignments.ts  # react-query + realtime for dated assignments

src/pages/
  ScheduleImportPage.tsx  # upload -> processing -> preview -> publish wizard
  AdminPanelPage.tsx      # MODIFY: add "ייבוא סידור שבועי" card, flag-gated

src/app/router.tsx         # MODIFY: add /schedule-import route under AdminRoute

src/pages/ShiftLivePage.tsx        # MODIFY: render dated assignment (planned/actual/updated-by) when flag on
src/hooks/useActiveBoard.ts        # MODIFY: no change to existing logic; new sibling hook added instead
src/components/AssignmentSwapModal.tsx  # commander/manager swap UI, used from ShiftLivePage

vitest.config.ts
package.json             # MODIFY: add vitest, xlsx, pdfjs-dist deps + test/typecheck scripts
```

**Rationale:** parser modules are one-file-one-responsibility so each is independently testable without React/Supabase in scope. `scheduleImports.ts`/`featureFlags.ts` mirror the existing `rosterBoards.ts`/`shiftTemplates.ts` pattern (thin Supabase wrapper + typed parsing of the JSON columns). UI is one new page (wizard has internal step state, doesn't need multiple page components) plus surgical edits to two existing files.

---

## Task 1: Vitest test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run test` (vitest run), `npm run test:watch` (vitest), `npm run typecheck` (`tsc -b --noEmit` equivalent via existing `tsc -b`)

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Add scripts to package.json**

Add to the `"scripts"` block in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc -b"
```

- [ ] **Step 4: Write and run a trivial smoke test to verify the harness works**

Create `src/lib/scheduleImport/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm run test`
Expected: 1 passed

- [ ] **Step 5: Delete the smoke test and commit**

```bash
rm src/lib/scheduleImport/smoke.test.ts
git add vitest.config.ts package.json package-lock.json
git commit -m "Add Vitest test infrastructure"
```

---

## Task 2: `detectFileKind` — magic-byte file sniffing

**Files:**
- Create: `src/lib/scheduleImport/types.ts`
- Create: `src/lib/scheduleImport/detectFileKind.ts`
- Test: `src/lib/scheduleImport/detectFileKind.test.ts`

**Interfaces:**
- Produces: `type FileKind = 'xlsx' | 'xls-html' | 'pdf' | 'unknown'`, `detectFileKind(bytes: Uint8Array): FileKind`

- [ ] **Step 1: Create the shared types file**

```typescript
// src/lib/scheduleImport/types.ts
export type FileKind = 'xlsx' | 'xls-html' | 'pdf' | 'unknown'

export type ShiftCategory = 'morning' | 'afternoon' | 'night'
export type WorkerKind = 'אחמ"ש' | 'מאבטח'

export type RawCell = {
  text: string
  entries: string[] // one raw cell can hold multiple stacked worker lines
}

export type RawGrid = {
  rows: RawCell[][]
}

export type ParseResult =
  | { supported: true; grid: RawGrid }
  | { supported: false; reason: string }

export type NormalizedAssignment = {
  work_date: string // YYYY-MM-DD
  shift_category: ShiftCategory
  worker_kind: WorkerKind
  position: string
  slot_index: number
  starts_at: string // ISO
  ends_at: string // ISO
  source_name: string | null
}

export type MatchedAssignment = NormalizedAssignment & {
  planned_user_id: string | null
  match_confidence: 'exact' | 'fuzzy' | 'none'
}

export type ValidationWarning = {
  kind: 'unmatched_name' | 'duplicate_slot' | 'empty_cell_skipped' | 'conflict_with_existing'
  message: string
  work_date?: string
  position?: string
}

export type ValidatedSchedule = {
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  conflicts: MatchedAssignment[]
  stats: { imported: number; skipped: number; unmatched_names: number }
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/lib/scheduleImport/detectFileKind.test.ts
import { describe, it, expect } from 'vitest'
import { detectFileKind } from './detectFileKind'

function bytesFrom(arr: number[]): Uint8Array {
  return new Uint8Array(arr)
}

function bytesFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('detectFileKind', () => {
  it('detects real xlsx by zip magic bytes', () => {
    expect(detectFileKind(bytesFrom([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).toBe('xlsx')
  })

  it('detects real legacy xls by OLE2 magic bytes', () => {
    expect(
      detectFileKind(bytesFrom([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe('xlsx')
  })

  it('detects pdf by %PDF header', () => {
    expect(detectFileKind(bytesFromText('%PDF-1.4\n...'))).toBe('pdf')
  })

  it('detects html-as-xls via <html tag', () => {
    expect(detectFileKind(bytesFromText('<html><body><table></table></body></html>'))).toBe(
      'xls-html',
    )
  })

  it('detects html-as-xls via bare <table tag with leading whitespace', () => {
    expect(detectFileKind(bytesFromText('  \n<table><tr><td>x</td></tr></table>'))).toBe(
      'xls-html',
    )
  })

  it('detects html-as-xls case-insensitively with a BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesFromText('<HTML><TABLE>')])
    expect(detectFileKind(withBom)).toBe('xls-html')
  })

  it('returns unknown for unrecognized bytes', () => {
    expect(detectFileKind(bytesFrom([1, 2, 3, 4, 5]))).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- detectFileKind`
Expected: FAIL — `detectFileKind` module not found

- [ ] **Step 3: Implement**

```typescript
// src/lib/scheduleImport/detectFileKind.ts
import type { FileKind } from './types'

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]
const PDF_MAGIC = '%PDF'

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  return magic.every((byte, i) => bytes[i] === byte)
}

function stripBom(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.slice(3)
  }
  return bytes
}

export function detectFileKind(bytes: Uint8Array): FileKind {
  if (startsWith(bytes, XLSX_MAGIC)) return 'xlsx'
  if (startsWith(bytes, OLE2_MAGIC)) return 'xlsx'

  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(stripBom(bytes).slice(0, 2048))
  const trimmed = decoded.trimStart()

  if (trimmed.startsWith(PDF_MAGIC)) return 'pdf'

  const lower = trimmed.toLowerCase()
  if (lower.startsWith('<html') || lower.startsWith('<!doctype html') || lower.startsWith('<table')) {
    return 'xls-html'
  }

  return 'unknown'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- detectFileKind`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleImport/types.ts src/lib/scheduleImport/detectFileKind.ts src/lib/scheduleImport/detectFileKind.test.ts
git commit -m "Add detectFileKind magic-byte sniffer for schedule import"
```

---

## Task 3: `normalizeSchedule` — the allowlist filter and grid-to-assignments core

This is the highest-value, highest-risk module (allowlist enforcement, per-cell hours, midnight crossing, multi-worker cells), so it's built and tested before the format-specific parsers that feed it.

**Files:**
- Create: `src/lib/scheduleImport/normalizeSchedule.ts`
- Test: `src/lib/scheduleImport/normalizeSchedule.test.ts`

**Interfaces:**
- Consumes: `RawGrid`, `RawCell` from `./types` (Task 2)
- Produces: `normalizeSchedule(grid: RawGrid, weekStart: Date): { assignments: NormalizedAssignment[]; excludedSectionsSeen: string[] }`

The grid convention this function expects (documented here since no real sample file was available at plan-writing time — **first thing to verify against the real file, see Task 3 Step 6**):
- Row 0: header row, one cell per day containing a day name and/or date (e.g. `"ראשון 07/09"`).
- A "section" cell in column 0 marks the start of a block: either a worker-kind section (`אחמ"ש` or `מאבטח`) or an excluded section (בקרה/היעדרויות/חופש/מחלה/מילואים/קורס/לימודים/תגבור). Rows belong to the most recent section cell seen above them.
- Within a worker-kind section, each row's remaining column-0-adjacent cell is a position/עמדה label, and the row's other cells (aligned to the header's day columns) hold `"HH:MM-HH:MM שם עובד"` (or multiple such lines stacked in one cell for multiple workers at that position/day).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/scheduleImport/normalizeSchedule.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeSchedule } from './normalizeSchedule'
import type { RawGrid } from './types'

function cell(text: string, entries: string[] = [text]) {
  return { text, entries: entries.filter((e) => e.trim().length > 0) }
}

const weekStart = new Date('2026-09-06T00:00:00.000Z') // a Sunday

describe('normalizeSchedule', () => {
  it('extracts a single morning אחמ"ש assignment with hours from the cell', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09'), cell('שני 07/09')],
        [cell('אחמ"ש')],
        [cell('שער ראשי'), cell('06:00-14:00 בדיקה־א׳'), cell('')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      work_date: '2026-09-06',
      worker_kind: 'אחמ"ש',
      position: 'שער ראשי',
      slot_index: 0,
      source_name: 'בדיקה־א׳',
    })
    expect(assignments[0].starts_at).toBe('2026-09-06T06:00:00.000Z')
    expect(assignments[0].ends_at).toBe('2026-09-06T14:00:00.000Z')
  })

  it('drops excluded sections entirely — not in output, no trace', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('היעדרויות')],
        [cell('שער ראשי'), cell('06:00-14:00 בדיקה־ב׳')],
        [cell('מאבטח')],
        [cell('שער צדדי'), cell('06:00-14:00 בדיקה־ג׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].position).toBe('שער צדדי')
    expect(assignments.some((a) => a.source_name === 'בדיקה־ב׳')).toBe(false)
  })

  it('leaves an empty cell as a skip, not an assignment', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער ראשי'), cell('')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(0)
  })

  it('produces two rows via slot_index for two workers stacked in one cell', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [
          cell('שער ראשי', []),
          cell('06:00-14:00 בדיקה־ד׳\n06:00-14:00 בדיקה־ה׳', [
            '06:00-14:00 בדיקה־ד׳',
            '06:00-14:00 בדיקה־ה׳',
          ]),
        ],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments).toHaveLength(2)
    expect(assignments.map((a) => a.slot_index).sort()).toEqual([0, 1])
    expect(assignments.map((a) => a.source_name).sort()).toEqual(['בדיקה־ד׳', 'בדיקה־ה׳'])
  })

  it('reads unusual/partial hours directly from the cell rather than defaulting', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('אחמ"ש')],
        [cell('שער ראשי'), cell('09:30-12:15 בדיקה־ו׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments[0].starts_at).toBe('2026-09-06T09:30:00.000Z')
    expect(assignments[0].ends_at).toBe('2026-09-06T12:15:00.000Z')
  })

  it('rolls ends_at to the next day for a night shift crossing midnight', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער ראשי'), cell('23:00-07:00 בדיקה־ז׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments[0].starts_at).toBe('2026-09-06T23:00:00.000Z')
    expect(assignments[0].ends_at).toBe('2026-09-07T07:00:00.000Z')
    expect(assignments[0].shift_category).toBe('night')
  })

  it('classifies shift_category from the start hour per SHIFT_CATEGORIES boundaries', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('א'), cell('07:00-15:00 בדיקה־ח׳')],
        [cell('ב'), cell('15:00-23:00 בדיקה־ט׳')],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments.find((a) => a.position === 'א')?.shift_category).toBe('morning')
    expect(assignments.find((a) => a.position === 'ב')?.shift_category).toBe('afternoon')
  })

  it('handles names with quotes, apostrophes, and extra spaces without corrupting them', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער'), cell("06:00-14:00 בדיקה  ד'ולי")],
      ],
    }
    const { assignments } = normalizeSchedule(grid, weekStart)
    expect(assignments[0].source_name).toBe("בדיקה ד'ולי")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- normalizeSchedule`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// src/lib/scheduleImport/normalizeSchedule.ts
import type { NormalizedAssignment, RawGrid, ShiftCategory, WorkerKind } from './types'

const WORKER_KIND_LABELS: Record<string, WorkerKind> = {
  'אחמ"ש': 'אחמ"ש',
  'אחמ״ש': 'אחמ"ש',
  מאבטח: 'מאבטח',
}

const EXCLUDED_SECTION_LABELS = new Set([
  'בקרה',
  'היעדרויות',
  'חופש',
  'מחלה',
  'מילואים',
  'קורס',
  'לימודים',
  'תגבור',
])

const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const CELL_ENTRY_PATTERN = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+(.+)$/

function normalizeSectionLabel(text: string): string {
  return text.trim().replace(/["'׳״]/g, '"').replace(/\s+/g, ' ')
}

function classifySection(rawLabel: string): { kind: 'worker'; workerKind: WorkerKind } | { kind: 'excluded' } | { kind: 'unknown' } {
  const label = normalizeSectionLabel(rawLabel)
  if (WORKER_KIND_LABELS[label]) {
    return { kind: 'worker', workerKind: WORKER_KIND_LABELS[label] }
  }
  if (EXCLUDED_SECTION_LABELS.has(label)) {
    return { kind: 'excluded' }
  }
  return { kind: 'unknown' }
}

function isSectionRow(row: { text: string }[]): boolean {
  if (row.length === 0) return false
  const first = normalizeSectionLabel(row[0].text)
  return classifySection(first).kind !== 'unknown' && row.slice(1).every((c) => c.text.trim() === '')
}

function parseHeaderDate(rawHeader: string, weekStart: Date): Date | null {
  const dayIndex = HEBREW_DAY_NAMES.findIndex((name) => rawHeader.includes(name))
  if (dayIndex === -1) return null
  const date = new Date(weekStart)
  date.setUTCDate(date.getUTCDate() + dayIndex)
  return date
}

function classifyCategory(startHour: number): ShiftCategory {
  if (startHour >= 7 && startHour < 15) return 'morning'
  if (startHour >= 15 && startHour < 23) return 'afternoon'
  return 'night'
}

function toIso(date: Date, hour: number, minute: number): string {
  const d = new Date(date)
  d.setUTCHours(hour, minute, 0, 0)
  return d.toISOString()
}

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

export function normalizeSchedule(
  grid: RawGrid,
  weekStart: Date,
): { assignments: NormalizedAssignment[]; excludedSectionsSeen: string[] } {
  const assignments: NormalizedAssignment[] = []
  const excludedSectionsSeen = new Set<string>()

  if (grid.rows.length === 0) return { assignments: [], excludedSectionsSeen: [] }

  const headerRow = grid.rows[0]
  const columnDates = headerRow.map((c) => parseHeaderDate(c.text, weekStart))

  let currentSection: { kind: 'worker'; workerKind: WorkerKind } | { kind: 'excluded' } | null = null

  for (let rowIndex = 1; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]
    if (row.length === 0) continue

    if (isSectionRow(row)) {
      const classified = classifySection(row[0].text)
      if (classified.kind === 'excluded') {
        excludedSectionsSeen.add(normalizeSectionLabel(row[0].text))
        currentSection = { kind: 'excluded' }
      } else if (classified.kind === 'worker') {
        currentSection = classified
      } else {
        currentSection = null
      }
      continue
    }

    if (!currentSection || currentSection.kind === 'excluded') {
      continue
    }

    const position = row[0].text.trim()
    if (!position) continue

    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const date = columnDates[colIndex]
      if (!date) continue

      const cellData = row[colIndex]
      const lines = cellData.entries.length > 0 ? cellData.entries : [cellData.text]

      let slotIndex = 0
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue

        const match = CELL_ENTRY_PATTERN.exec(trimmedLine)
        if (!match) continue

        const [, startHourStr, startMinStr, endHourStr, endMinStr, nameRaw] = match
        const startHour = Number(startHourStr)
        const startMin = Number(startMinStr)
        const endHour = Number(endHourStr)
        const endMin = Number(endMinStr)

        const startsAt = toIso(date, startHour, startMin)
        const crossesMidnight = endHour < startHour || (endHour === startHour && endMin < startMin)
        const endDate = new Date(date)
        if (crossesMidnight) endDate.setUTCDate(endDate.getUTCDate() + 1)
        const endsAt = toIso(endDate, endHour, endMin)

        assignments.push({
          work_date: date.toISOString().slice(0, 10),
          shift_category: classifyCategory(startHour),
          worker_kind: currentSection.workerKind,
          position,
          slot_index: slotIndex,
          starts_at: startsAt,
          ends_at: endsAt,
          source_name: cleanName(nameRaw),
        })
        slotIndex += 1
      }
    }
  }

  return { assignments, excludedSectionsSeen: Array.from(excludedSectionsSeen) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- normalizeSchedule`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleImport/normalizeSchedule.ts src/lib/scheduleImport/normalizeSchedule.test.ts
git commit -m "Add normalizeSchedule with excluded-section allowlist and per-cell hour parsing"
```

- [ ] **Step 6: Flag for real-file verification (do not skip)**

Add a comment at the top of `normalizeSchedule.ts`:

```typescript
// GRID CONVENTION ASSUMPTION — verify against a real weekly schedule file
// before relying on this in production. See design spec "Open questions".
// Expected shape: header row = day names/dates; column-0 section cells
// (אחמ"ש / מאבטח / excluded labels) start a block; subsequent column-0
// cells are position labels; other cells are "HH:MM-HH:MM name" lines.
```

This is not optional cleanup — it is the explicit checkpoint the spec calls out ("this is called out explicitly in the implementation plan as a required verification step, not an assumption to skip"). If a real file is available by this point in execution, pause here, load it, and adjust `isSectionRow`/`CELL_ENTRY_PATTERN`/column layout to match before continuing to Task 4.

---

## Task 4: `parseExcelSchedule` — real xlsx and HTML-as-xls, converging on `RawGrid`

**Files:**
- Create: `src/lib/scheduleImport/parseExcelSchedule.ts`
- Test: `src/lib/scheduleImport/parseExcelSchedule.test.ts`

**Interfaces:**
- Consumes: `FileKind` (Task 2), `RawGrid`/`RawCell` (Task 2)
- Produces: `parseExcelSchedule(bytes: Uint8Array, kind: 'xlsx' | 'xls-html'): RawGrid`

- [ ] **Step 1: Install xlsx**

```bash
npm install xlsx
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/lib/scheduleImport/parseExcelSchedule.test.ts
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseExcelSchedule } from './parseExcelSchedule'

function buildTestWorkbookBytes(): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([
    ['', 'ראשון 06/09'],
    ['אחמ"ש'],
    ['שער ראשי', '06:00-14:00 בדיקה־א׳'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Uint8Array(out)
}

describe('parseExcelSchedule', () => {
  it('parses a real xlsx workbook into a RawGrid', () => {
    const bytes = buildTestWorkbookBytes()
    const grid = parseExcelSchedule(bytes, 'xlsx')
    expect(grid.rows[0][1].text).toContain('ראשון')
    expect(grid.rows[1][0].text).toBe('אחמ"ש')
    expect(grid.rows[2][1].text).toContain('בדיקה־א׳')
  })

  it('parses HTML-as-xls into the same RawGrid shape', () => {
    const html = `
      <html><body><table>
        <tr><td></td><td>ראשון 06/09</td></tr>
        <tr><td>אחמ"ש</td></tr>
        <tr><td>שער ראשי</td><td>06:00-14:00 בדיקה־ב׳</td></tr>
      </table></body></html>
    `
    const bytes = new TextEncoder().encode(html)
    const grid = parseExcelSchedule(bytes, 'xls-html')
    expect(grid.rows[0][1].text).toContain('ראשון')
    expect(grid.rows[2][1].text).toContain('בדיקה־ב׳')
  })

  it('splits multiple <br>-separated lines in one HTML cell into entries', () => {
    const html = `
      <table>
        <tr><td></td><td>ראשון 06/09</td></tr>
        <tr><td>מאבטח</td></tr>
        <tr><td>שער</td><td>06:00-14:00 בדיקה־ג׳<br>06:00-14:00 בדיקה־ד׳</td></tr>
      </table>
    `
    const bytes = new TextEncoder().encode(html)
    const grid = parseExcelSchedule(bytes, 'xls-html')
    expect(grid.rows[2][1].entries).toHaveLength(2)
    expect(grid.rows[2][1].entries[0]).toContain('בדיקה־ג׳')
    expect(grid.rows[2][1].entries[1]).toContain('בדיקה־ד׳')
  })

  it('respects HTML rowspan/colspan by leaving spanned cells empty rather than misaligning columns', () => {
    const html = `
      <table>
        <tr><td colspan="2">ראשון 06/09</td></tr>
        <tr><td>מאבטח</td></tr>
        <tr><td>שער</td><td>06:00-14:00 בדיקה־ה׳</td></tr>
      </table>
    `
    const bytes = new TextEncoder().encode(html)
    const grid = parseExcelSchedule(bytes, 'xls-html')
    expect(grid.rows[0][0].text).toContain('ראשון')
    expect(grid.rows[0][1].text).toBe('')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- parseExcelSchedule`
Expected: FAIL — module not found

- [ ] **Step 4: Implement**

```typescript
// src/lib/scheduleImport/parseExcelSchedule.ts
import * as XLSX from 'xlsx'
import type { RawCell, RawGrid } from './types'

function splitEntries(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function parseRealWorkbook(bytes: Uint8Array): RawGrid {
  const workbook = XLSX.read(bytes, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheetName]
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })

  const rows: RawCell[][] = aoa.map((row) =>
    row.map((value) => {
      const text = String(value ?? '').trim()
      return { text, entries: splitEntries(text) }
    }),
  )

  return { rows }
}

function parseHtmlTable(bytes: Uint8Array): RawGrid {
  const html = new TextDecoder('utf-8').decode(bytes)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return { rows: [] }

  const trElements = Array.from(table.querySelectorAll('tr'))
  // Track colspan/rowspan occupancy so spanned cells don't shift later columns.
  const occupied: boolean[][] = []

  const rows: RawCell[][] = trElements.map((tr, rowIndex) => {
    occupied[rowIndex] = occupied[rowIndex] ?? []
    const cells: RawCell[] = []
    let colCursor = 0

    const tds = Array.from(tr.querySelectorAll('td, th'))
    for (const td of tds) {
      while (occupied[rowIndex]?.[colCursor]) colCursor += 1

      const rawHtml = td.innerHTML.replace(/<br\s*\/?>/gi, '\n')
      const tempDoc = new DOMParser().parseFromString(`<div>${rawHtml}</div>`, 'text/html')
      const text = (tempDoc.body.textContent ?? '').trim()

      cells[colCursor] = { text, entries: splitEntries(text) }

      const colspan = Number(td.getAttribute('colspan') ?? '1')
      const rowspan = Number(td.getAttribute('rowspan') ?? '1')
      for (let r = 0; r < rowspan; r++) {
        occupied[rowIndex + r] = occupied[rowIndex + r] ?? []
        for (let c = 0; c < colspan; c++) {
          occupied[rowIndex + r][colCursor + c] = true
        }
      }
      colCursor += colspan
    }

    return cells.map((c) => c ?? { text: '', entries: [] })
  })

  return { rows }
}

export function parseExcelSchedule(bytes: Uint8Array, kind: 'xlsx' | 'xls-html'): RawGrid {
  if (kind === 'xlsx') return parseRealWorkbook(bytes)
  return parseHtmlTable(bytes)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- parseExcelSchedule`
Expected: 4 passed

Note: `parseHtmlTable` uses `DOMParser`, which is available in the browser (where this runs client-side per the spec) and in Vitest's default `node` environment only if `happy-dom`/`jsdom` is configured. Since the test file above calls it directly, add `// @vitest-environment jsdom` as the first line of `parseExcelSchedule.test.ts` and install jsdom:

```bash
npm install -D jsdom
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduleImport/parseExcelSchedule.ts src/lib/scheduleImport/parseExcelSchedule.test.ts package.json package-lock.json
git commit -m "Add parseExcelSchedule for real xlsx and HTML-masquerading-as-xls files"
```

---

## Task 5: `matchNames` — Hebrew-aware fuzzy name matching

**Files:**
- Create: `src/lib/scheduleImport/matchNames.ts`
- Test: `src/lib/scheduleImport/matchNames.test.ts`

**Interfaces:**
- Consumes: `NormalizedAssignment` (Task 2/3), a `profiles`-shaped list `{ id: string; full_name: string | null }[]`
- Produces: `matchNames(assignments: NormalizedAssignment[], profiles: { id: string; full_name: string | null }[]): MatchedAssignment[]`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/scheduleImport/matchNames.test.ts
import { describe, it, expect } from 'vitest'
import { matchNames } from './matchNames'
import type { NormalizedAssignment } from './types'

function assignment(sourceName: string | null): NormalizedAssignment {
  return {
    work_date: '2026-09-06',
    shift_category: 'morning',
    worker_kind: 'מאבטח',
    position: 'שער',
    slot_index: 0,
    starts_at: '2026-09-06T06:00:00.000Z',
    ends_at: '2026-09-06T14:00:00.000Z',
    source_name: sourceName,
  }
}

describe('matchNames', () => {
  const profiles = [
    { id: 'u1', full_name: 'בדיקה־א׳' },
    { id: 'u2', full_name: 'בדיקה ב' },
  ]

  it('matches an exact name', () => {
    const [result] = matchNames([assignment('בדיקה־א׳')], profiles)
    expect(result.planned_user_id).toBe('u1')
    expect(result.match_confidence).toBe('exact')
  })

  it('matches despite different quote characters and spacing', () => {
    const [result] = matchNames([assignment("בדיקה  א'")], profiles)
    expect(result.planned_user_id).toBe('u1')
    expect(result.match_confidence).toBe('exact')
  })

  it('suggests a fuzzy match for a small typo, never auto-confirmed as exact', () => {
    const [result] = matchNames([assignment('בדיקה ג')], profiles)
    expect(result.planned_user_id).toBe('u2')
    expect(result.match_confidence).toBe('fuzzy')
  })

  it('leaves an unresolvable name unmatched rather than guessing', () => {
    const [result] = matchNames([assignment('שם שלא קיים בכלל')], profiles)
    expect(result.planned_user_id).toBeNull()
    expect(result.match_confidence).toBe('none')
  })

  it('leaves a null source_name unmatched', () => {
    const [result] = matchNames([assignment(null)], profiles)
    expect(result.planned_user_id).toBeNull()
    expect(result.match_confidence).toBe('none')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- matchNames`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// src/lib/scheduleImport/matchNames.ts
import type { MatchedAssignment, NormalizedAssignment } from './types'

function normalizeForMatch(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/["'׳״]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[a.length][b.length]
}

export function matchNames(
  assignments: NormalizedAssignment[],
  profiles: { id: string; full_name: string | null }[],
): MatchedAssignment[] {
  const normalizedProfiles = profiles
    .filter((p): p is { id: string; full_name: string } => !!p.full_name)
    .map((p) => ({ id: p.id, normalized: normalizeForMatch(p.full_name) }))

  return assignments.map((assignment) => {
    if (!assignment.source_name) {
      return { ...assignment, planned_user_id: null, match_confidence: 'none' }
    }

    const normalizedSource = normalizeForMatch(assignment.source_name)

    const exact = normalizedProfiles.find((p) => p.normalized === normalizedSource)
    if (exact) {
      return { ...assignment, planned_user_id: exact.id, match_confidence: 'exact' }
    }

    let best: { id: string; distance: number } | null = null
    for (const p of normalizedProfiles) {
      const distance = levenshtein(normalizedSource, p.normalized)
      if (distance <= 2 && (!best || distance < best.distance)) {
        best = { id: p.id, distance }
      }
    }

    if (best) {
      return { ...assignment, planned_user_id: best.id, match_confidence: 'fuzzy' }
    }

    return { ...assignment, planned_user_id: null, match_confidence: 'none' }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- matchNames`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleImport/matchNames.ts src/lib/scheduleImport/matchNames.test.ts
git commit -m "Add Hebrew-aware fuzzy name matching for schedule import"
```

---

## Task 6: `validateSchedule` — warnings, conflicts, stats

**Files:**
- Create: `src/lib/scheduleImport/validateSchedule.ts`
- Test: `src/lib/scheduleImport/validateSchedule.test.ts`

**Interfaces:**
- Consumes: `MatchedAssignment[]` (Task 5), an `existing: { work_date: string; shift_category: string; position: string; slot_index: number; is_manually_edited: boolean }[]` snapshot of currently published assignments for the affected week
- Produces: `validateSchedule(assignments: MatchedAssignment[], existing: ExistingAssignmentSummary[]): ValidatedSchedule`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/scheduleImport/validateSchedule.test.ts
import { describe, it, expect } from 'vitest'
import { validateSchedule } from './validateSchedule'
import type { MatchedAssignment } from './types'

function matched(overrides: Partial<MatchedAssignment> = {}): MatchedAssignment {
  return {
    work_date: '2026-09-06',
    shift_category: 'morning',
    worker_kind: 'מאבטח',
    position: 'שער',
    slot_index: 0,
    starts_at: '2026-09-06T06:00:00.000Z',
    ends_at: '2026-09-06T14:00:00.000Z',
    source_name: 'בדיקה־א׳',
    planned_user_id: 'u1',
    match_confidence: 'exact',
    ...overrides,
  }
}

describe('validateSchedule', () => {
  it('counts a clean import with no warnings', () => {
    const result = validateSchedule([matched()], [])
    expect(result.stats).toEqual({ imported: 1, skipped: 0, unmatched_names: 0 })
    expect(result.warnings).toHaveLength(0)
  })

  it('flags an unmatched name as a warning and counts it', () => {
    const result = validateSchedule([matched({ planned_user_id: null, match_confidence: 'none' })], [])
    expect(result.stats.unmatched_names).toBe(1)
    expect(result.warnings.some((w) => w.kind === 'unmatched_name')).toBe(true)
  })

  it('flags a duplicate identity key within the same file', () => {
    const dup = matched()
    const result = validateSchedule([dup, { ...dup }], [])
    expect(result.warnings.some((w) => w.kind === 'duplicate_slot')).toBe(true)
  })

  it('flags a conflict when an existing manually-edited row would be overwritten', () => {
    const result = validateSchedule(
      [matched()],
      [
        {
          work_date: '2026-09-06',
          shift_category: 'morning',
          position: 'שער',
          slot_index: 0,
          is_manually_edited: true,
        },
      ],
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.warnings.some((w) => w.kind === 'conflict_with_existing')).toBe(true)
  })

  it('does not flag a conflict against a non-manually-edited existing row', () => {
    const result = validateSchedule(
      [matched()],
      [
        {
          work_date: '2026-09-06',
          shift_category: 'morning',
          position: 'שער',
          slot_index: 0,
          is_manually_edited: false,
        },
      ],
    )
    expect(result.conflicts).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- validateSchedule`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// src/lib/scheduleImport/validateSchedule.ts
import type { MatchedAssignment, ValidatedSchedule, ValidationWarning } from './types'

export type ExistingAssignmentSummary = {
  work_date: string
  shift_category: string
  position: string
  slot_index: number
  is_manually_edited: boolean
}

function identityKey(a: { work_date: string; shift_category: string; position: string; slot_index: number }): string {
  return `${a.work_date}|${a.shift_category}|${a.position}|${a.slot_index}`
}

export function validateSchedule(
  assignments: MatchedAssignment[],
  existing: ExistingAssignmentSummary[],
): ValidatedSchedule {
  const warnings: ValidationWarning[] = []
  const seenKeys = new Map<string, number>()
  const existingByKey = new Map(existing.map((e) => [identityKey(e), e]))
  const conflicts: MatchedAssignment[] = []

  let unmatchedCount = 0

  for (const assignment of assignments) {
    const key = identityKey(assignment)
    seenKeys.set(key, (seenKeys.get(key) ?? 0) + 1)

    if (assignment.match_confidence === 'none') {
      unmatchedCount += 1
      warnings.push({
        kind: 'unmatched_name',
        message: `שם לא זוהה: ${assignment.source_name ?? '(ריק)'}`,
        work_date: assignment.work_date,
        position: assignment.position,
      })
    }

    const existingRow = existingByKey.get(key)
    if (existingRow?.is_manually_edited) {
      conflicts.push(assignment)
      warnings.push({
        kind: 'conflict_with_existing',
        message: `שיבוץ זה נערך ידנית ולא יידרס אוטומטית: ${assignment.position} ${assignment.work_date}`,
        work_date: assignment.work_date,
        position: assignment.position,
      })
    }
  }

  for (const [key, count] of seenKeys) {
    if (count > 1) {
      const [work_date, , position] = key.split('|')
      warnings.push({
        kind: 'duplicate_slot',
        message: `כפילות בקובץ: ${position} ${work_date}`,
        work_date,
        position,
      })
    }
  }

  return {
    assignments,
    warnings,
    conflicts,
    stats: {
      imported: assignments.length,
      skipped: 0,
      unmatched_names: unmatchedCount,
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- validateSchedule`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleImport/validateSchedule.ts src/lib/scheduleImport/validateSchedule.test.ts
git commit -m "Add validateSchedule warnings/conflicts/stats computation"
```

---

## Task 7: `parsePdfSchedule` — text-layer extraction

**Files:**
- Create: `src/lib/scheduleImport/parsePdfSchedule.ts`
- Test: `src/lib/scheduleImport/parsePdfSchedule.test.ts`

**Interfaces:**
- Produces: `parsePdfSchedule(bytes: Uint8Array): Promise<ParseResult>` (from `./types`, Task 2)

- [ ] **Step 1: Install pdfjs-dist**

```bash
npm install pdfjs-dist
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/lib/scheduleImport/parsePdfSchedule.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parsePdfSchedule } from './parsePdfSchedule'

vi.mock('pdfjs-dist', () => {
  return {
    getDocument: (_opts: unknown) => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [
              { str: 'ראשון 06/09', transform: [1, 0, 0, 1, 100, 700] },
              { str: 'אחמ"ש', transform: [1, 0, 0, 1, 10, 650] },
              { str: 'שער ראשי', transform: [1, 0, 0, 1, 10, 600] },
              { str: '06:00-14:00 בדיקה־א׳', transform: [1, 0, 0, 1, 100, 600] },
            ],
          }),
        }),
      }),
    }),
    GlobalWorkerOptions: {},
  }
})

describe('parsePdfSchedule', () => {
  it('extracts a RawGrid from a text-layer pdf', async () => {
    const result = await parsePdfSchedule(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(result.supported).toBe(true)
    if (result.supported) {
      const flatText = result.grid.rows.flat().map((c) => c.text).join(' ')
      expect(flatText).toContain('בדיקה־א׳')
    }
  })

  it('reports unsupported for a scanned pdf with no extractable text', async () => {
    vi.doMock('pdfjs-dist', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
        }),
      }),
      GlobalWorkerOptions: {},
    }))
    const { parsePdfSchedule: freshParse } = await import('./parsePdfSchedule')
    const result = await freshParse(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(result.supported).toBe(false)
    if (!result.supported) {
      expect(result.reason).toContain('סרוק')
    }
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- parsePdfSchedule`
Expected: FAIL — module not found

- [ ] **Step 4: Implement**

```typescript
// src/lib/scheduleImport/parsePdfSchedule.ts
import * as pdfjsLib from 'pdfjs-dist'
import type { ParseResult, RawCell, RawGrid } from './types'

const MIN_TEXT_ITEMS_FOR_SUPPORTED = 4

type TextItem = { str: string; transform: number[] }

function clusterIntoGrid(items: TextItem[]): RawGrid {
  if (items.length === 0) return { rows: [] }

  // transform[5] is the Y position (PDF coordinate space, larger = higher on page).
  // Group items into rows by Y (rounded, since exact alignment varies slightly),
  // then sort each row left-to-right by X (transform[4]).
  const rowsByY = new Map<number, TextItem[]>()
  for (const item of items) {
    const y = Math.round(item.transform[5] / 5) * 5 // bucket to tolerate minor jitter
    const bucket = rowsByY.get(y) ?? []
    bucket.push(item)
    rowsByY.set(y, bucket)
  }

  const sortedYs = Array.from(rowsByY.keys()).sort((a, b) => b - a) // top of page first

  const rows: RawCell[][] = sortedYs.map((y) => {
    const rowItems = rowsByY.get(y)!.sort((a, b) => a.transform[4] - b.transform[4])
    return rowItems.map((item) => ({ text: item.str.trim(), entries: [item.str.trim()] }))
  })

  return { rows }
}

export async function parsePdfSchedule(bytes: Uint8Array): Promise<ParseResult> {
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

  if (allItems.length < MIN_TEXT_ITEMS_FOR_SUPPORTED) {
    return { supported: false, reason: 'קובץ PDF סרוק — לא נתמך בשלב זה. יש להעלות כקובץ Excel.' }
  }

  return { supported: true, grid: clusterIntoGrid(allItems) }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- parsePdfSchedule`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduleImport/parsePdfSchedule.ts src/lib/scheduleImport/parsePdfSchedule.test.ts package.json package-lock.json
git commit -m "Add parsePdfSchedule text-layer extraction with scanned-pdf detection"
```

---

## Task 8: `parseImageSchedule` — phase-1 stub

**Files:**
- Create: `src/lib/scheduleImport/parseImageSchedule.ts`
- Test: `src/lib/scheduleImport/parseImageSchedule.test.ts`

**Interfaces:**
- Produces: `parseImageSchedule(images: Uint8Array[]): Promise<ParseResult>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/scheduleImport/parseImageSchedule.test.ts
import { describe, it, expect } from 'vitest'
import { parseImageSchedule } from './parseImageSchedule'

describe('parseImageSchedule', () => {
  it('reports unsupported in phase 1, for one image', async () => {
    const result = await parseImageSchedule([new Uint8Array([0xff, 0xd8, 0xff])])
    expect(result.supported).toBe(false)
    if (!result.supported) {
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  it('reports unsupported for multiple images', async () => {
    const result = await parseImageSchedule([
      new Uint8Array([0xff, 0xd8, 0xff]),
      new Uint8Array([0xff, 0xd8, 0xff]),
    ])
    expect(result.supported).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- parseImageSchedule`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// src/lib/scheduleImport/parseImageSchedule.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- parseImageSchedule`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleImport/parseImageSchedule.ts src/lib/scheduleImport/parseImageSchedule.test.ts
git commit -m "Add parseImageSchedule phase-1 stub (image import deferred to phase 2)"
```

---

## Task 9: Database schema — three new tables + feature flags (local Supabase stack)

**Files:**
- Create: `supabase/phase20_schedule_import_schema.sql`

**Interfaces:**
- Produces: tables `public.schedule_imports`, `public.shift_assignments`, `public.staffing_change_log`, `public.app_feature_flags`, matching the spec's Data model section exactly

- [ ] **Step 1: Local Supabase stack (already running)**

The controller already set this up before dispatching this task — do not redo it, just use it: `supabase/config.toml` was created via `npx supabase init` with all local ports shifted by +1000 (55321–55329) to avoid colliding with an unrelated project's local Supabase stack that was already running on this machine. All 24 of the project's existing flat `supabase/phase*.sql`/`schema.sql`/`rls.sql` files were copied into `supabase/migrations/` with sequential timestamps (`20260101000001`–`20260101000024`, in the order documented in SPEC.md §3) and applied via `npx supabase db reset`, so the local Postgres instance now has the exact same 7 baseline tables (`profiles`, `roster_boards`, `shift_types`, `shift_templates`, `push_subscriptions`, `push_notification_log`, `pending_invites`) and their RLS/functions as production. Verify this is still the case before proceeding: `docker exec supabase_db_guardflow psql -U postgres -d postgres -c "\dt public.*"` should list all 7 tables. If the containers aren't running, start them with `npx supabase start` (from the repo root) — do not run `npx supabase init` again (it already exists) and do not change the ports in `supabase/config.toml`.

Note: `supabase/migrations/` is a local-only bootstrap convenience (not part of this feature's deliverable) — it is git-ignored, not committed. This task's actual deliverable stays `supabase/phase20_schedule_import_schema.sql`, in the project's existing flat-file convention, applied directly against the local Postgres container (see Step 3) — not folded into `supabase/migrations/`.

- [ ] **Step 2: Write the migration file**

```sql
-- supabase/phase20_schedule_import_schema.sql
-- Additive only. Does not modify roster_boards, profiles, shift_templates,
-- or shift_types. See docs/superpowers/specs/2026-08-31-weekly-schedule-import-design.md

create table public.schedule_imports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  source_kind text not null check (source_kind in ('excel', 'pdf', 'image')),
  storage_path text not null,
  original_filename text not null,
  content_hash text not null,
  status text not null default 'processing'
    check (status in ('processing', 'ready_for_review', 'published', 'failed', 'cancelled')),
  stats jsonb not null default '{}',
  parse_warnings jsonb not null default '[]',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, content_hash)
);

comment on table public.schedule_imports is
  'One row per uploaded weekly schedule file. Publishing writes shift_assignments via the publish_schedule_import RPC; this table never itself holds staffing data.';

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift_category text not null check (shift_category in ('morning', 'afternoon', 'night')),
  worker_kind text not null check (worker_kind in ('אחמ"ש', 'מאבטח')),
  position text not null,
  slot_index int not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source_name text,
  planned_user_id uuid references public.profiles(id),
  actual_user_id uuid references public.profiles(id),
  actual_name text,
  source text not null default 'excel' check (source in ('excel', 'pdf', 'image', 'manual')),
  import_id uuid references public.schedule_imports(id),
  is_manually_edited boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_date, shift_category, position, slot_index)
);

comment on table public.shift_assignments is
  'Dated staffing layer, separate from roster_boards.guard_names (which stays non-dated and unchanged). Written only via publish_schedule_import and replace_assignment_worker — no direct client writes.';

create index shift_assignments_work_date_idx on public.shift_assignments (work_date);

create table public.staffing_change_log (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  from_user_id uuid references public.profiles(id),
  from_name text,
  to_user_id uuid references public.profiles(id),
  to_name text,
  reason text,
  change_kind text not null check (
    change_kind in ('manual_replace', 'import_update', 'import_kept_manual', 'import_revert_to_file')
  ),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

comment on table public.staffing_change_log is
  'Audit trail for shift_assignments.actual_* changes, written only by publish_schedule_import and replace_assignment_worker.';

create table public.app_feature_flags (
  id text primary key,
  enabled boolean not null default false,
  allowed_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.app_feature_flags is
  'Simple manager-controlled feature flags. weekly_schedule_import gates the entire schedule-import UI and its Live-page integration.';

insert into public.app_feature_flags (id, enabled, allowed_user_ids)
values ('weekly_schedule_import', false, '{}');
```

- [ ] **Step 3: Apply the migration to the local stack**

Apply the SQL above directly to the local Postgres container (never the production project):

```bash
docker exec -i supabase_db_guardflow psql -U postgres -d postgres < supabase/phase20_schedule_import_schema.sql
```

- [ ] **Step 4: Verify the tables exist**

```bash
docker exec supabase_db_guardflow psql -U postgres -d postgres -c "\dt public.schedule_imports public.shift_assignments public.staffing_change_log public.app_feature_flags"
docker exec supabase_db_guardflow psql -U postgres -d postgres -c "select id, enabled, allowed_user_ids from public.app_feature_flags"
```

Confirm all 4 tables are listed and the seeded `weekly_schedule_import` row (`enabled = false`) is present.

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/phase20_schedule_import_schema.sql
git commit -m "Add schedule_imports, shift_assignments, staffing_change_log, app_feature_flags tables"
```

---

## Task 10: RLS policies

**Files:**
- Create: `supabase/phase20b_schedule_import_rls.sql`

**Interfaces:**
- Consumes: tables from Task 9, existing `public.get_my_role()` function
- Produces: RLS enabled + policies exactly matching the spec's RLS table

- [ ] **Step 1: Write the migration**

```sql
-- supabase/phase20b_schedule_import_rls.sql

alter table public.schedule_imports enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.staffing_change_log enable row level security;
alter table public.app_feature_flags enable row level security;

-- schedule_imports: manager only, direct access (low-risk metadata, no RPC needed)
create policy "schedule_imports select manager"
  on public.schedule_imports for select
  to authenticated
  using (public.get_my_role() = 'מנהל');

create policy "schedule_imports insert manager"
  on public.schedule_imports for insert
  to authenticated
  with check (public.get_my_role() = 'מנהל');

create policy "schedule_imports update manager"
  on public.schedule_imports for update
  to authenticated
  using (public.get_my_role() = 'מנהל')
  with check (public.get_my_role() = 'מנהל');

-- shift_assignments: readable by any authenticated user for published rows;
-- unpublished rows are manager-only. No insert/update/delete policy at all —
-- writes only happen through security definer RPCs (Task 11).
create policy "shift_assignments select published or manager"
  on public.shift_assignments for select
  to authenticated
  using (published = true or public.get_my_role() = 'מנהל');

-- staffing_change_log: readable by manager and commander, no direct writes.
create policy "staffing_change_log select manager or commander"
  on public.staffing_change_log for select
  to authenticated
  using (public.get_my_role() in ('מנהל', 'אחמ"ש'));

-- app_feature_flags: any authenticated user can read (needed to gate the UI),
-- only manager can write.
create policy "app_feature_flags select all authenticated"
  on public.app_feature_flags for select
  to authenticated
  using (true);

create policy "app_feature_flags update manager"
  on public.app_feature_flags for update
  to authenticated
  using (public.get_my_role() = 'מנהל')
  with check (public.get_my_role() = 'מנהל');
```

- [ ] **Step 2: Apply to the local stack**

```bash
docker exec -i supabase_db_guardflow psql -U postgres -d postgres < supabase/phase20b_schedule_import_rls.sql
```

- [ ] **Step 3: Verify with advisors**

`mcp__supabase__get_advisors` is a hosted-project-only feature and has no local equivalent — skip it here. Run it once against production during the promotion step (Task 23-equivalent for production rollout, after user approval), not as part of local development.

- [ ] **Step 4: Manually verify the flag is readable**

```bash
docker exec supabase_db_guardflow psql -U postgres -d postgres -c "select * from app_feature_flags"
docker exec supabase_db_guardflow psql -U postgres -d postgres -c "select count(*) from shift_assignments"
```

Confirm the seeded `weekly_schedule_import` row is returned and `shift_assignments` returns `0` without an RLS error (this direct psql connection is the postgres superuser, not RLS-restricted — RLS-as-a-real-user checks happen via the RPC tests in Task 11 Step 3, which impersonate real JWTs).

- [ ] **Step 5: Commit**

```bash
git add supabase/phase20b_schedule_import_rls.sql
git commit -m "Add RLS policies for schedule import tables"
```

---

## Task 11: RPCs — `publish_schedule_import` and `replace_assignment_worker`

**Files:**
- Create: `supabase/phase20c_schedule_import_rpcs.sql`

**Interfaces:**
- Consumes: tables from Task 9, `public.get_my_role()`
- Produces: `publish_schedule_import(p_import_id uuid, p_assignments jsonb, p_resolutions jsonb, p_dry_run boolean) returns jsonb`, `replace_assignment_worker(p_assignment_id uuid, p_new_user_id uuid, p_new_name text, p_reason text) returns public.shift_assignments`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/phase20c_schedule_import_rpcs.sql

-- p_assignments: jsonb array of objects matching MatchedAssignment shape
-- (work_date, shift_category, worker_kind, position, slot_index, starts_at,
-- ends_at, source_name, planned_user_id).
-- p_resolutions: jsonb object mapping "work_date|shift_category|position|slot_index"
-- -> "revert_to_file" for rows the manager explicitly chose to overwrite
-- despite a manual-edit conflict. Any key not present defaults to "keep_manual".
create or replace function public.publish_schedule_import(
  p_import_id uuid,
  p_assignments jsonb,
  p_resolutions jsonb default '{}'::jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.get_my_role();
  incoming record;
  existing_row public.shift_assignments;
  identity_key text;
  resolution text;
  to_insert jsonb := '[]'::jsonb;
  to_update jsonb := '[]'::jsonb;
  to_skip_manual jsonb := '[]'::jsonb;
  conflicts jsonb := '[]'::jsonb;
  new_assignment_id uuid;
  week_start_date date;
begin
  if coalesce(caller_role, '') <> 'מנהל' then
    raise exception 'Only מנהל can publish a schedule import' using errcode = '42501';
  end if;

  for incoming in select * from jsonb_to_recordset(p_assignments) as x(
    work_date date,
    shift_category text,
    worker_kind text,
    position text,
    slot_index int,
    starts_at timestamptz,
    ends_at timestamptz,
    source_name text,
    planned_user_id uuid
  )
  loop
    identity_key := incoming.work_date::text || '|' || incoming.shift_category || '|' || incoming.position || '|' || incoming.slot_index::text;
    resolution := coalesce(p_resolutions ->> identity_key, 'keep_manual');

    select * into existing_row
    from public.shift_assignments
    where work_date = incoming.work_date
      and shift_category = incoming.shift_category
      and position = incoming.position
      and slot_index = incoming.slot_index;

    if existing_row.id is not null and existing_row.is_manually_edited and resolution <> 'revert_to_file' then
      to_skip_manual := to_skip_manual || jsonb_build_object('identity_key', identity_key);
      conflicts := conflicts || to_jsonb(incoming);
      continue;
    end if;

    if existing_row.id is null then
      to_insert := to_insert || to_jsonb(incoming);
    else
      to_update := to_update || to_jsonb(incoming);
    end if;

    if not p_dry_run then
      if existing_row.id is null then
        insert into public.shift_assignments (
          work_date, shift_category, worker_kind, position, slot_index,
          starts_at, ends_at, source_name, planned_user_id, actual_user_id,
          actual_name, source, import_id, is_manually_edited, published
        ) values (
          incoming.work_date, incoming.shift_category, incoming.worker_kind, incoming.position, incoming.slot_index,
          incoming.starts_at, incoming.ends_at, incoming.source_name, incoming.planned_user_id, incoming.planned_user_id,
          incoming.source_name, 'excel', p_import_id, false, true
        )
        returning id into new_assignment_id;

        insert into public.staffing_change_log (assignment_id, to_user_id, to_name, change_kind, changed_by)
        values (new_assignment_id, incoming.planned_user_id, incoming.source_name, 'import_update', auth.uid());
      else
        update public.shift_assignments
        set
          starts_at = incoming.starts_at,
          ends_at = incoming.ends_at,
          source_name = incoming.source_name,
          planned_user_id = incoming.planned_user_id,
          actual_user_id = case when resolution = 'revert_to_file' then incoming.planned_user_id else actual_user_id end,
          actual_name = case when resolution = 'revert_to_file' then incoming.source_name else actual_name end,
          is_manually_edited = case when resolution = 'revert_to_file' then false else is_manually_edited end,
          import_id = p_import_id,
          published = true,
          updated_at = now()
        where id = existing_row.id;

        insert into public.staffing_change_log (assignment_id, from_user_id, from_name, to_user_id, to_name, change_kind, changed_by)
        values (
          existing_row.id, existing_row.actual_user_id, existing_row.actual_name,
          incoming.planned_user_id, incoming.source_name,
          case when resolution = 'revert_to_file' then 'import_revert_to_file' else 'import_kept_manual' end,
          auth.uid()
        );
      end if;
    end if;
  end loop;

  -- Delete assignments from a prior import for weeks touched by this file
  -- that are no longer present in it and were never manually edited.
  if not p_dry_run then
    select (p_assignments -> 0 ->> 'work_date')::date into week_start_date;
    if week_start_date is not null then
      delete from public.shift_assignments sa
      where sa.work_date between week_start_date and week_start_date + interval '6 days'
        and sa.is_manually_edited = false
        and not exists (
          select 1 from jsonb_to_recordset(p_assignments) as x(work_date date, shift_category text, position text, slot_index int)
          where x.work_date = sa.work_date and x.shift_category = sa.shift_category
            and x.position = sa.position and x.slot_index = sa.slot_index
        );
    end if;

    update public.schedule_imports set status = 'published', updated_at = now() where id = p_import_id;
  end if;

  return jsonb_build_object(
    'to_insert', to_insert,
    'to_update', to_update,
    'to_skip_manual', to_skip_manual,
    'conflicts', conflicts
  );
end;
$$;

grant execute on function public.publish_schedule_import(uuid, jsonb, jsonb, boolean) to authenticated;

comment on function public.publish_schedule_import(uuid, jsonb, jsonb, boolean) is
  'Manager-only. Upserts shift_assignments from a parsed weekly import on the (work_date, shift_category, position, slot_index) identity key. Manually-edited rows are preserved unless explicitly resolved to revert_to_file. dry_run=true computes the diff without writing.';

create or replace function public.replace_assignment_worker(
  p_assignment_id uuid,
  p_new_user_id uuid,
  p_new_name text,
  p_reason text
)
returns public.shift_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.get_my_role();
  target_row public.shift_assignments;
  updated_row public.shift_assignments;
begin
  if coalesce(caller_role, '') not in ('מנהל', 'אחמ"ש') then
    raise exception 'Only מנהל or אחמ"ש can replace an assignment worker' using errcode = '42501';
  end if;

  select * into target_row from public.shift_assignments where id = p_assignment_id;
  if target_row.id is null then
    raise exception 'Assignment not found';
  end if;

  if caller_role = 'אחמ"ש' then
    if not (now() >= target_row.starts_at and now() < target_row.ends_at) then
      raise exception 'אחמ"ש יכול להחליף רק שיבוץ פעיל כעת' using errcode = '42501';
    end if;
  end if;

  update public.shift_assignments
  set
    actual_user_id = p_new_user_id,
    actual_name = p_new_name,
    is_manually_edited = true,
    updated_at = now()
  where id = p_assignment_id
  returning * into updated_row;

  insert into public.staffing_change_log (
    assignment_id, from_user_id, from_name, to_user_id, to_name, reason, change_kind, changed_by
  ) values (
    p_assignment_id, target_row.actual_user_id, target_row.actual_name, p_new_user_id, p_new_name, p_reason, 'manual_replace', auth.uid()
  );

  return updated_row;
end;
$$;

grant execute on function public.replace_assignment_worker(uuid, uuid, text, text) to authenticated;

comment on function public.replace_assignment_worker(uuid, uuid, text, text) is
  'Manager can replace any assignment worker. אחמ"ש can only replace the worker on an assignment currently in progress (now between starts_at and ends_at). Always logs to staffing_change_log.';
```

- [ ] **Step 2: Apply to the local stack**

```bash
docker exec -i supabase_db_guardflow psql -U postgres -d postgres < supabase/phase20c_schedule_import_rpcs.sql
```

- [ ] **Step 3: Manually verify both RPCs with real calls**

Create three synthetic local test users first (clearly-labeled test data, never real personnel — matches the plan's testing constraint), one per role, directly via SQL since this is local-only:

```bash
docker exec -i supabase_db_guardflow psql -U postgres -d postgres <<'EOF'
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'test-manager@local.test'),
  ('00000000-0000-0000-0000-000000000002', 'test-commander@local.test'),
  ('00000000-0000-0000-0000-000000000003', 'test-guard@local.test')
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name, app_role) values
  ('00000000-0000-0000-0000-000000000001', 'test-manager@local.test', 'בדיקה מנהל', 'מנהל'),
  ('00000000-0000-0000-0000-000000000002', 'test-commander@local.test', 'בדיקה אחמש', 'אחמ"ש'),
  ('00000000-0000-0000-0000-000000000003', 'test-guard@local.test', 'בדיקה מאבטח', 'מאבטח')
on conflict (id) do update set app_role = excluded.app_role;
EOF
```

Then impersonate each role in a psql session using the same `request.jwt.claim.sub` technique ROADMAP.md documents was already used to verify Phase 6/7's live RLS (`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '<test user id>';` before each RPC call, inside a transaction so the impersonation doesn't leak to later statements):

```bash
docker exec -i supabase_db_guardflow psql -U postgres -d postgres <<'EOF'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; -- manager
select public.publish_schedule_import(
  gen_random_uuid(), '[]'::jsonb, '{}'::jsonb, true
);
rollback;
EOF
```

Run through all of:
- Call `publish_schedule_import` with `p_dry_run = true` and a small synthetic assignments array (as manager); confirm it returns a diff and writes zero rows (`select count(*) from shift_assignments` stays 0).
- Call it again with `p_dry_run = false` (as manager, in its own committed transaction — do not `rollback` this one); confirm rows appear and `staffing_change_log` has matching entries.
- Call it a second time with the identical assignments; confirm no new rows, no duplicate log entries (idempotency).
- Attempt the call as the guard test user (`request.jwt.claim.sub` = the guard id); confirm it raises `42501`.
- Call `replace_assignment_worker` as the manager test user on an assignment outside its time window; confirm it succeeds (manager has no time restriction).
- Call it as the commander test user on an assignment outside its time window; confirm `42501`. Then on one within its time window; confirm success.

- [ ] **Step 4: Commit**

```bash
git add supabase/phase20c_schedule_import_rpcs.sql
git commit -m "Add publish_schedule_import and replace_assignment_worker RPCs"
```

---

## Task 12: Private storage bucket + storage RLS

**Files:**
- Create: `supabase/phase20d_schedule_import_storage.sql`

**Interfaces:**
- Produces: private bucket `schedule-imports` with manager-only storage policies

- [ ] **Step 1: Write the migration**

```sql
-- supabase/phase20d_schedule_import_storage.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'schedule-imports',
  'schedule-imports',
  false,
  26214400, -- 25 MB
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/html',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

create policy "schedule-imports manager read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל');

create policy "schedule-imports manager write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל');

create policy "schedule-imports manager delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'schedule-imports' and public.get_my_role() = 'מנהל');
```

- [ ] **Step 2: Apply to the local stack**

```bash
docker exec -i supabase_db_guardflow psql -U postgres -d postgres < supabase/phase20d_schedule_import_storage.sql
```

- [ ] **Step 3: Verify bucket is private**

```bash
docker exec supabase_db_guardflow psql -U postgres -d postgres -c "select id, public from storage.buckets where id = 'schedule-imports'"
```

Confirm `public = false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/phase20d_schedule_import_storage.sql
git commit -m "Add private schedule-imports storage bucket with manager-only RLS"
```

---

## Task 13: `scheduleImports.ts` and `featureFlags.ts` — thin Supabase wrappers

**Files:**
- Create: `src/lib/featureFlags.ts`
- Create: `src/lib/scheduleImports.ts`

**Interfaces:**
- Consumes: `supabase` client from `src/lib/supabase.ts` (existing)
- Produces: `fetchFeatureFlag(id: string): Promise<{ enabled: boolean; allowed_user_ids: string[] } | null>`, `uploadScheduleFile(file: File, weekStart: string, contentHash: string): Promise<{ storagePath: string }>`, `createScheduleImport(input): Promise<ScheduleImportRow>`, `updateScheduleImportStoragePath(importId: string, storagePath: string): Promise<void>`, `callPublishScheduleImport(input): Promise<PublishResult>`, `callReplaceAssignmentWorker(input): Promise<ShiftAssignment>`, `fetchShiftAssignmentsForWeek(weekStart: string): Promise<ShiftAssignment[]>`

- [ ] **Step 1: Implement `featureFlags.ts`, following the existing `rosterBoards.ts` error-message convention**

```typescript
// src/lib/featureFlags.ts
import { supabase } from './supabase'

export type FeatureFlag = {
  id: string
  enabled: boolean
  allowed_user_ids: string[]
}

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

export async function fetchFeatureFlag(id: string): Promise<FeatureFlag | null> {
  const { data, error } = await supabase
    .from('app_feature_flags')
    .select('id, enabled, allowed_user_ids')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch feature flag', error))
  }

  return data as FeatureFlag | null
}
```

- [ ] **Step 2: Implement `scheduleImports.ts`**

```typescript
// src/lib/scheduleImports.ts
import { supabase } from './supabase'
import type { MatchedAssignment } from './scheduleImport/types'

export type ScheduleImportRow = {
  id: string
  week_start: string
  source_kind: 'excel' | 'pdf' | 'image'
  storage_path: string
  original_filename: string
  content_hash: string
  status: 'processing' | 'ready_for_review' | 'published' | 'failed' | 'cancelled'
  stats: { imported: number; skipped: number; unmatched_names: number }
  parse_warnings: unknown[]
  created_by: string
  created_at: string
  updated_at: string
}

export type ShiftAssignment = {
  id: string
  work_date: string
  shift_category: 'morning' | 'afternoon' | 'night'
  worker_kind: 'אחמ"ש' | 'מאבטח'
  position: string
  slot_index: number
  starts_at: string
  ends_at: string
  source_name: string | null
  planned_user_id: string | null
  actual_user_id: string | null
  actual_name: string | null
  source: 'excel' | 'pdf' | 'image' | 'manual'
  import_id: string | null
  is_manually_edited: boolean
  published: boolean
}

export type PublishResult = {
  to_insert: unknown[]
  to_update: unknown[]
  to_skip_manual: unknown[]
  conflicts: unknown[]
}

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

export async function computeContentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._֐-׿-]/g, '_')
}

export async function uploadScheduleFile(
  file: File,
  weekStart: string,
  importId: string,
): Promise<{ storagePath: string }> {
  const safeName = sanitizeFilename(file.name)
  const storagePath = `${weekStart}/${importId}/${safeName}`

  const { error } = await supabase.storage.from('schedule-imports').upload(storagePath, file, {
    upsert: false,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to upload schedule file', error))
  }

  return { storagePath }
}

export async function createScheduleImport(input: {
  week_start: string
  source_kind: 'excel' | 'pdf' | 'image'
  storage_path: string
  original_filename: string
  content_hash: string
}): Promise<ScheduleImportRow> {
  const { data, error } = await supabase
    .from('schedule_imports')
    .insert(input)
    .select()
    .single()

  if (error) {
    throw new Error(getErrorMessage('Failed to create schedule import record', error))
  }

  return data as ScheduleImportRow
}

export async function updateScheduleImportStoragePath(
  importId: string,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase
    .from('schedule_imports')
    .update({ storage_path: storagePath })
    .eq('id', importId)

  if (error) {
    throw new Error(getErrorMessage('Failed to record schedule import storage path', error))
  }
}

export async function callPublishScheduleImport(input: {
  importId: string
  assignments: MatchedAssignment[]
  resolutions: Record<string, 'revert_to_file'>
  dryRun: boolean
}): Promise<PublishResult> {
  const { data, error } = await supabase.rpc('publish_schedule_import', {
    p_import_id: input.importId,
    p_assignments: input.assignments,
    p_resolutions: input.resolutions,
    p_dry_run: input.dryRun,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to publish schedule import', error))
  }

  return data as PublishResult
}

export async function callReplaceAssignmentWorker(input: {
  assignmentId: string
  newUserId: string | null
  newName: string
  reason: string
}): Promise<ShiftAssignment> {
  const { data, error } = await supabase.rpc('replace_assignment_worker', {
    p_assignment_id: input.assignmentId,
    p_new_user_id: input.newUserId,
    p_new_name: input.newName,
    p_reason: input.reason,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to replace assignment worker', error))
  }

  return data as ShiftAssignment
}

export async function fetchShiftAssignmentsForWeek(weekStart: string): Promise<ShiftAssignment[]> {
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)

  const { data, error } = await supabase
    .from('shift_assignments')
    .select('*')
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd.toISOString().slice(0, 10))

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift assignments', error))
  }

  return (data ?? []) as ShiftAssignment[]
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/featureFlags.ts src/lib/scheduleImports.ts
git commit -m "Add featureFlags and scheduleImports Supabase client wrappers"
```

---

## Task 14: `useFeatureFlag` and `useShiftAssignments` hooks

**Files:**
- Create: `src/hooks/useFeatureFlag.ts`
- Create: `src/hooks/useShiftAssignments.ts`

**Interfaces:**
- Consumes: `fetchFeatureFlag` (Task 13), `fetchShiftAssignmentsForWeek` (Task 13), `useAuth` (existing, `src/contexts/AuthContext.tsx`)
- Produces: `useFeatureFlag(id: string): { enabled: boolean; loading: boolean }`, `useShiftAssignmentsForWeek(weekStart: string): UseQueryResult<ShiftAssignment[]>` with Realtime subscription

- [ ] **Step 1: Implement `useFeatureFlag`**

```typescript
// src/hooks/useFeatureFlag.ts
import { useQuery } from '@tanstack/react-query'
import { fetchFeatureFlag } from '../lib/featureFlags'
import { useAuth } from '../contexts/AuthContext'

export function useFeatureFlag(id: string): { enabled: boolean; loading: boolean } {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: ['feature-flag', id],
    queryFn: () => fetchFeatureFlag(id),
  })

  if (query.isLoading) return { enabled: false, loading: true }

  const flag = query.data
  if (!flag || !flag.enabled) return { enabled: false, loading: false }

  if (flag.allowed_user_ids.length === 0) return { enabled: true, loading: false }

  const enabled = !!user && flag.allowed_user_ids.includes(user.id)
  return { enabled, loading: false }
}
```

Check `src/contexts/AuthContext.tsx` for the exact shape of `useAuth()`'s return value (specifically the `user` field's presence and shape) before finalizing this file — match whatever the existing context actually exports rather than assuming.

- [ ] **Step 2: Implement `useShiftAssignments.ts`**

```typescript
// src/hooks/useShiftAssignments.ts
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchShiftAssignmentsForWeek, type ShiftAssignment } from '../lib/scheduleImports'

export function useShiftAssignmentsForWeek(weekStart: string) {
  const queryClient = useQueryClient()
  const queryKey = ['shift-assignments', weekStart]

  const query = useQuery({
    queryKey,
    queryFn: () => fetchShiftAssignmentsForWeek(weekStart),
  })

  useEffect(() => {
    const channel = supabase
      .channel(`shift-assignments-${weekStart}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shift_assignments' },
        () => {
          queryClient.invalidateQueries({ queryKey })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [weekStart, queryClient, queryKey])

  return query
}

export type { ShiftAssignment }
```

This is a **separate** channel/hook from `useActiveBoard`'s existing `roster_boards` subscription — it does not modify that file, satisfying the "no change to existing logic" constraint.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFeatureFlag.ts src/hooks/useShiftAssignments.ts
git commit -m "Add useFeatureFlag and useShiftAssignmentsForWeek hooks"
```

---

## Task 15: `parse-schedule` edge function (server-side PDF parsing)

**Files:**
- Create: `supabase/functions/parse-schedule/index.ts`

**Interfaces:**
- Consumes: `parsePdfSchedule`, `normalizeSchedule`, `matchNames`, `validateSchedule` logic (ported inline — Deno edge functions can't import from `src/`, so the parsing logic is duplicated in Deno-compatible form, mirroring how `send-position-push`/`reset-shift-names` are already self-contained per-function scripts in this codebase)
- Produces: an HTTP endpoint accepting `{ storagePath: string, weekStart: string }`, returning `{ assignments: MatchedAssignment[], warnings: ValidationWarning[], stats: {...} }`

- [ ] **Step 1: Inspect an existing edge function for the request-handling and auth-check convention**

Read `supabase/functions/reset-shift-names/index.ts` and `supabase/functions/send-position-push/index.ts` to match this project's existing Deno edge function conventions (imports, CORS handling, service-role client construction, error response shape) before writing the new function.

- [ ] **Step 2: Implement the edge function**

```typescript
// supabase/functions/parse-schedule/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type TextItem = { str: string; transform: number[] }

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await userClient
      .from('profiles')
      .select('app_role')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (profile?.app_role !== 'מנהל') {
      return new Response(JSON.stringify({ error: 'Only מנהל can parse schedule files' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { storagePath } = await req.json()
    if (!storagePath) {
      return new Response(JSON.stringify({ error: 'storagePath is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const serviceClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('schedule-imports')
      .download(storagePath)

    if (downloadError || !fileData) {
      return new Response(JSON.stringify({ error: 'Failed to download file' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      return new Response(
        JSON.stringify({ supported: false, reason: 'קובץ PDF סרוק — לא נתמך בשלב זה.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const grid = clusterIntoGrid(allItems)

    // NOTE: normalizeSchedule/matchNames/validateSchedule logic must be kept
    // in sync with src/lib/scheduleImport/*.ts by hand, since Deno edge
    // functions cannot import from src/. This is the same constraint already
    // accepted by this codebase's other edge functions (each is self-contained).
    return new Response(JSON.stringify({ supported: true, grid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

Note: this function returns the raw `grid`; `normalizeSchedule`/`matchNames`/`validateSchedule` still run client-side on the returned grid (same modules used for the Excel path), so the Deno/browser duplication is limited to grid extraction only, not the allowlist/business logic — keeping the single-source-of-truth pipeline the spec requires.

- [ ] **Step 3: Serve locally**

```bash
npx supabase functions serve parse-schedule --env-file supabase/functions/.env.local
```

(Create `supabase/functions/.env.local` — gitignored — with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` copied from `npx supabase status`'s local output, if the CLI doesn't already inject them automatically for local serving.)

- [ ] **Step 4: Manually verify with a real PDF upload**

Upload a small synthetic text-layer PDF fixture to the `schedule-imports` bucket on the local stack (via the JS client against the local `API_URL`, or `docker exec` + direct storage insert), obtain a real JWT for the manager test user created in Task 11 Step 3 (via the local GoTrue admin API or `supabase auth` CLI helpers), call the locally-served function with the file's storage path and that JWT, and confirm it returns `{ supported: true, grid: [...] }`. Then call it with the guard test user's JWT and confirm a 403.

Actual deployment to production (`supabase functions deploy` or the `mcp__supabase__deploy_edge_function` tool) happens only after the user explicitly approves promoting this feature to production — not part of this task.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/parse-schedule/index.ts
git commit -m "Add parse-schedule edge function for server-side PDF text extraction"
```

---

## Task 16: `ScheduleImportPage` — upload step

**Files:**
- Create: `src/pages/ScheduleImportPage.tsx`

**Interfaces:**
- Consumes: `detectFileKind`, `parseExcelSchedule`, `computeContentHash`, `uploadScheduleFile`, `createScheduleImport` (prior tasks)
- Produces: `ScheduleImportPage` React component, exported for router wiring in Task 19

- [ ] **Step 1: Implement the upload step of the wizard**

```typescript
// src/pages/ScheduleImportPage.tsx
import { useState } from 'react'
import { detectFileKind } from '../lib/scheduleImport/detectFileKind'
import { parseExcelSchedule } from '../lib/scheduleImport/parseExcelSchedule'
import { normalizeSchedule } from '../lib/scheduleImport/normalizeSchedule'
import { matchNames } from '../lib/scheduleImport/matchNames'
import { validateSchedule, type ExistingAssignmentSummary } from '../lib/scheduleImport/validateSchedule'
import type { MatchedAssignment, ValidationWarning } from '../lib/scheduleImport/types'
import { computeContentHash, createScheduleImport, uploadScheduleFile, updateScheduleImportStoragePath, fetchShiftAssignmentsForWeek } from '../lib/scheduleImports'
import { useProfiles } from '../hooks/useProfiles'

type WizardStep = 'upload' | 'processing' | 'preview' | 'error'

function getReadableError(error: unknown): string {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

function getPreviousSunday(date: Date): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() - result.getUTCDay())
  result.setUTCHours(0, 0, 0, 0)
  return result
}

export function ScheduleImportPage() {
  const [step, setStep] = useState<WizardStep>('upload')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [importId, setImportId] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<MatchedAssignment[]>([])
  const [warnings, setWarnings] = useState<ValidationWarning[]>([])
  const [stats, setStats] = useState({ imported: 0, skipped: 0, unmatched_names: 0 })

  const profilesQuery = useProfiles()

  async function handleFileSelected(file: File) {
    setStep('processing')
    setErrorMessage(null)

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind = detectFileKind(bytes)

      if (kind === 'unknown') {
        throw new Error('סוג הקובץ לא זוהה. יש להעלות קובץ Excel (.xls/.xlsx) או PDF.')
      }
      if (kind === 'pdf') {
        throw new Error('קבצי PDF מעובדים בשלב נפרד. תמיכה זו תתווסף בהמשך המשימה.')
      }

      const grid = parseExcelSchedule(bytes, kind)
      const weekStart = getPreviousSunday(new Date())
      const { assignments: normalized } = normalizeSchedule(grid, weekStart)

      const profiles = (profilesQuery.data ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))
      const matched = matchNames(normalized, profiles)

      const weekStartIso = weekStart.toISOString().slice(0, 10)
      const existingAssignments = await fetchShiftAssignmentsForWeek(weekStartIso)
      const existingSummaries: ExistingAssignmentSummary[] = existingAssignments.map((a) => ({
        work_date: a.work_date,
        shift_category: a.shift_category,
        position: a.position,
        slot_index: a.slot_index,
        is_manually_edited: a.is_manually_edited,
      }))

      const validated = validateSchedule(matched, existingSummaries)

      const contentHash = await computeContentHash(bytes)
      const scheduleImport = await createScheduleImport({
        week_start: weekStartIso,
        source_kind: 'excel',
        storage_path: '', // placeholder until the upload below completes and this row is updated
        original_filename: file.name,
        content_hash: contentHash,
      })

      const { storagePath } = await uploadScheduleFile(file, weekStartIso, scheduleImport.id)
      await updateScheduleImportStoragePath(scheduleImport.id, storagePath)

      setImportId(scheduleImport.id)
      setAssignments(validated.assignments)
      setWarnings(validated.warnings)
      setStats(validated.stats)
      setStep('preview')
    } catch (error) {
      setErrorMessage(getReadableError(error))
      setStep('error')
    }
  }

  if (step === 'upload' || step === 'error') {
    return (
      <div dir="rtl" className="p-4">
        <h1 className="text-xl font-bold mb-4">ייבוא סידור שבועי</h1>
        {errorMessage && (
          <div className="bg-red-100 text-red-800 p-3 rounded mb-4" role="alert">
            {errorMessage}
          </div>
        )}
        <input
          type="file"
          accept=".xls,.xlsx,.pdf"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFileSelected(file)
          }}
        />
      </div>
    )
  }

  if (step === 'processing') {
    return (
      <div dir="rtl" className="p-4">
        <p>מעבד את הקובץ…</p>
      </div>
    )
  }

  return (
    <SchedulePreview
      importId={importId!}
      assignments={assignments}
      warnings={warnings}
      stats={stats}
      onCancel={() => setStep('upload')}
    />
  )
}

// Placeholder signature — implemented in Task 17.
function SchedulePreview(props: {
  importId: string
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  stats: { imported: number; skipped: number; unmatched_names: number }
  onCancel: () => void
}) {
  return <div dir="rtl">Preview placeholder — implemented in Task 17 ({props.assignments.length} assignments, {props.stats.imported} imported)</div>
}
```

Before finalizing, read `src/hooks/useProfiles.ts` to confirm the exact return shape (`profilesQuery.data` item fields) and adjust the `.map` call above if `full_name` is named differently.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/ScheduleImportPage.tsx
git commit -m "Add ScheduleImportPage upload and processing steps"
```

---

## Task 17: `ScheduleImportPage` — preview, edit, and publish steps

**Files:**
- Modify: `src/pages/ScheduleImportPage.tsx`

**Interfaces:**
- Consumes: `callPublishScheduleImport` (Task 13), `MatchedAssignment[]`/`ValidationWarning[]` (Task 16 state)
- Produces: replaces the `SchedulePreview` placeholder from Task 16 with the full reviewable table + publish action

- [ ] **Step 1: Replace the `SchedulePreview` placeholder with a real implementation**

```typescript
// Replace the SchedulePreview function in src/pages/ScheduleImportPage.tsx with:

function SchedulePreview({
  importId,
  assignments: initialAssignments,
  warnings,
  stats,
  onCancel,
}: {
  importId: string
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  stats: { imported: number; skipped: number; unmatched_names: number }
  onCancel: () => void
}) {
  const [assignments, setAssignments] = useState(initialAssignments)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const profilesQuery = useProfiles()

  function removeRow(index: number) {
    setAssignments((prev) => prev.filter((_, i) => i !== index))
  }

  function assignExistingProfile(index: number, userId: string, name: string) {
    setAssignments((prev) =>
      prev.map((a, i) => (i === index ? { ...a, planned_user_id: userId, source_name: name, match_confidence: 'exact' as const } : a)),
    )
  }

  function editName(index: number, name: string) {
    setAssignments((prev) => prev.map((a, i) => (i === index ? { ...a, source_name: name } : a)))
  }

  async function handlePublish() {
    setPublishing(true)
    setPublishError(null)
    try {
      await callPublishScheduleImport({
        importId,
        assignments,
        resolutions: {},
        dryRun: false,
      })
      setPublished(true)
    } catch (error) {
      setPublishError(getReadableError(error))
    } finally {
      setPublishing(false)
    }
  }

  if (published) {
    return (
      <div dir="rtl" className="p-4">
        <p className="text-green-700 font-bold">הסידור פורסם בהצלחה.</p>
      </div>
    )
  }

  return (
    <div dir="rtl" className="p-4">
      <h1 className="text-xl font-bold mb-2">תצוגה מקדימה</h1>
      <p className="mb-4">
        ייקלטו: {stats.imported} · דולגו: {stats.skipped} · שמות שלא זוהו: {stats.unmatched_names}
      </p>

      {warnings.length > 0 && (
        <ul className="bg-yellow-50 text-yellow-900 p-3 rounded mb-4">
          {warnings.map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}

      <table className="w-full text-right mb-4">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>משמרת</th>
            <th>תפקיד</th>
            <th>עמדה</th>
            <th>שעות</th>
            <th>שם</th>
            <th>התאמה</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a, i) => (
            <tr key={i}>
              <td>{a.work_date}</td>
              <td>{a.shift_category}</td>
              <td>{a.worker_kind}</td>
              <td>{a.position}</td>
              <td>
                {new Date(a.starts_at).toISOString().slice(11, 16)}–{new Date(a.ends_at).toISOString().slice(11, 16)}
              </td>
              <td>
                <input
                  value={a.source_name ?? ''}
                  onChange={(e) => editName(i, e.target.value)}
                  className="border rounded px-1"
                />
              </td>
              <td>
                {a.match_confidence === 'exact' && '✓'}
                {a.match_confidence === 'fuzzy' && (
                  <select onChange={(e) => assignExistingProfile(i, e.target.value, a.source_name ?? '')} defaultValue="">
                    <option value="" disabled>
                      אישור התאמה
                    </option>
                    {(profilesQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                )}
                {a.match_confidence === 'none' && (
                  <select onChange={(e) => assignExistingProfile(i, e.target.value, a.source_name ?? '')} defaultValue="">
                    <option value="" disabled>
                      בחר עובד קיים
                    </option>
                    {(profilesQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td>
                <button type="button" onClick={() => removeRow(i)}>
                  הסר
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {publishError && (
        <div className="bg-red-100 text-red-800 p-3 rounded mb-4" role="alert">
          {publishError}
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={publishing}>
          ביטול
        </button>
        <button type="button" onClick={handlePublish} disabled={publishing}>
          {publishing ? 'מפרסם…' : 'פרסם'}
        </button>
      </div>
    </div>
  )
}
```

Before finalizing, read `src/hooks/useProfiles.ts` to confirm `profilesQuery.data` item field names (`id`, `full_name`) match what's used here.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/ScheduleImportPage.tsx
git commit -m "Add ScheduleImportPage preview, edit, and publish steps"
```

---

## Task 18: Wire up the route and AdminPanelPage card, gated by the feature flag

**Files:**
- Modify: `src/app/router.tsx`
- Modify: `src/pages/AdminPanelPage.tsx`

**Interfaces:**
- Consumes: `ScheduleImportPage` (Task 16/17), `useFeatureFlag` (Task 14)

- [ ] **Step 1: Add the route**

In `src/app/router.tsx`, add the import:

```typescript
import { ScheduleImportPage } from '../pages/ScheduleImportPage'
```

And add the route inside the existing `<Route element={<AdminRoute />}>` block (alongside `/admin`, `/roster-editor`, `/users`, `/shift-templates`):

```typescript
<Route path="/schedule-import" element={<ScheduleImportPage />} />
```

- [ ] **Step 2: Add the flag-gated card to AdminPanelPage**

In `src/pages/AdminPanelPage.tsx`, add the import:

```typescript
import { useFeatureFlag } from '../hooks/useFeatureFlag'
```

Inside the `AdminPanelPage` function body, add:

```typescript
const scheduleImportFlag = useFeatureFlag('weekly_schedule_import')
```

Then render a card conditionally (find where other admin cards/links are rendered — likely near existing navigation buttons to `/users`/`/shift-templates` — and add alongside them, matching the existing card style):

```tsx
{scheduleImportFlag.enabled && (
  <button type="button" onClick={() => navigate('/schedule-import')} className="/* match existing card classes */">
    ייבוא סידור שבועי
  </button>
)}
```

Read the surrounding JSX in `AdminPanelPage.tsx` first to match its actual existing card/button markup and class names exactly, rather than inventing new styling.

- [ ] **Step 3: Point the dev server at the local stack, then verify the flag gate**

All manual UI verification from this task onward (Tasks 18-20, 23) runs against the **local** Supabase stack, never production. Create a `.env.development.local` (git-ignored automatically by the existing `.env.*` rule in `.gitignore`) with the local stack's URL and anon key from `npx supabase status`:

```
VITE_SUPABASE_URL=http://127.0.0.1:55321
VITE_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status`>
```

Vite loads `.env.development.local` automatically for `npm run dev`, overriding `.env.local` — this keeps production credentials in `.env.local` untouched and unused for the rest of this plan's manual verification.

The synthetic test users created via raw SQL in Task 11 Step 3 have no password and cannot sign in through the app's login UI (they bypass GoTrue). For UI-based manual verification, create real local test accounts instead, using the local Studio at the `STUDIO_URL` from `npx supabase status` (e.g. `http://127.0.0.1:55323`) → Authentication → Add user (email + password, e.g. `test-manager@local.test`), then set that user's `profiles.app_role` via `docker exec supabase_db_guardflow psql -U postgres -d postgres -c "update profiles set app_role = 'מנהל', full_name = 'בדיקה מנהל' where email = 'test-manager@local.test'"`. Repeat for a commander and guard test account. These are separate from the Task 11 SQL-only users (which stay for RPC-level SQL testing); both sets are synthetic, clearly-labeled test data.

Run `npm run dev`, sign in as the local test manager account. With the `weekly_schedule_import` flag row's `enabled = false` (the seeded default), confirm neither the `/admin` card nor navigating directly to `/schedule-import` shows the feature (route should still resolve — `AdminRoute` still permits access — but the page itself should reasonably handle a disabled flag; add a simple guard inside `ScheduleImportPage` that renders "התכונה אינה זמינה" when `!useFeatureFlag('weekly_schedule_import').enabled`, so a manager who bookmarks the URL doesn't reach a half-built wizard when the flag is off).

Add this guard now:

```typescript
// At the top of the ScheduleImportPage component body, in src/pages/ScheduleImportPage.tsx:
const flag = useFeatureFlag('weekly_schedule_import')
if (flag.loading) return null
if (!flag.enabled) {
  return (
    <div dir="rtl" className="p-4">
      <p>התכונה אינה זמינה כרגע.</p>
    </div>
  )
}
```

Then flip the flag on the local stack and reload:

```bash
docker exec supabase_db_guardflow psql -U postgres -d postgres -c "update app_feature_flags set enabled = true where id = 'weekly_schedule_import'"
```

(Leaving `allowed_user_ids` empty means every authenticated user sees it once enabled, per `useFeatureFlag`'s logic — fine for local testing; scope it to specific ids if narrower testing is needed.) Confirm the card and full wizard now appear.

- [ ] **Step 4: Commit**

```bash
git add src/app/router.tsx src/pages/AdminPanelPage.tsx src/pages/ScheduleImportPage.tsx
git commit -m "Wire up /schedule-import route and flag-gated AdminPanelPage card"
```

---

## Task 19: `ShiftLivePage` dated-assignment display

**Files:**
- Modify: `src/pages/ShiftLivePage.tsx`

**Interfaces:**
- Consumes: `useShiftAssignmentsForWeek` (Task 14), `useFeatureFlag` (Task 14)

- [ ] **Step 1: Read the current rendering logic**

Read `src/pages/ShiftLivePage.tsx` in full (already read during planning: it renders `board.guard_names?.[role]?.name` per role at lines 112 and 165) to identify exactly where each role's name is rendered, so the new dated view slots in without disturbing the existing non-dated rendering path.

- [ ] **Step 2: Add the flag-gated dated overlay**

Add near the top of the `ShiftLivePage` component:

```typescript
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import { useShiftAssignmentsForWeek } from '../hooks/useShiftAssignments'

// inside the component:
const scheduleImportFlag = useFeatureFlag('weekly_schedule_import')
const todayIso = new Date().toISOString().slice(0, 10)
const weekStartIso = (() => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
})()
const assignmentsQuery = useShiftAssignmentsForWeek(scheduleImportFlag.enabled ? weekStartIso : '')

function findDatedAssignment(position: string) {
  if (!scheduleImportFlag.enabled) return null
  return (
    assignmentsQuery.data?.find(
      (a) => a.work_date === todayIso && a.position === position && a.published,
    ) ?? null
  )
}
```

Then, at each of the two locations currently rendering `guard_names?.[role]?.name` (near lines 112 and 165 — the exact `role`/`position` variable name in scope must be confirmed by re-reading those lines, since the spec's `shift_assignments.position` may correspond to what this file currently calls `role`), replace the single-name render with a small inline component:

```tsx
function DatedOrLegacyName({ legacyName, position, scheduleImportEnabled, assignmentsQuery, todayIso }: {
  legacyName: string | null
  position: string
  scheduleImportEnabled: boolean
  assignmentsQuery: ReturnType<typeof useShiftAssignmentsForWeek>
  todayIso: string
}) {
  if (!scheduleImportEnabled) {
    return <span>{legacyName ?? '—'}</span>
  }

  const dated = assignmentsQuery.data?.find(
    (a) => a.work_date === todayIso && a.position === position && a.published,
  )

  if (!dated) {
    return <span>{legacyName ?? '—'}</span>
  }

  const plannedLabel = dated.source_name ?? '—'
  const actualLabel = dated.actual_name ?? plannedLabel

  return (
    <div>
      <div>תוכנן: {plannedLabel}</div>
      {dated.is_manually_edited && <div>בפועל: {actualLabel}</div>}
    </div>
  )
}
```

Wire this component in place of the existing `{board.guard_names?.[role]?.name ?? ...}` expressions, passing `legacyName={board.guard_names?.[role]?.name ?? null}` and `position={role}` (adjust the variable name to whatever the file actually calls it).

- [ ] **Step 3: Manually verify with the flag off**

With `weekly_schedule_import` disabled (default), run `npm run dev`, load `/shift-live`, and confirm the page renders **exactly** as before — same names, same layout, no console errors. This is the critical regression check the spec requires ("בדיקה שהפיצ׳ר הקיים ממשיך לעבוד כאשר ה־feature flag כבוי").

- [ ] **Step 4: Manually verify with the flag on and a published dated assignment**

Enable the flag for your test manager account, publish a synthetic import for the current week (via the wizard, Task 17) covering today's date, reload `/shift-live`, and confirm "תוכנן:"/"בפועל:" render for the matching position.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ShiftLivePage.tsx
git commit -m "Add flag-gated dated-assignment display to ShiftLivePage"
```

---

## Task 20: Commander/manager swap UI

**Files:**
- Create: `src/components/AssignmentSwapModal.tsx`
- Modify: `src/pages/ShiftLivePage.tsx`

**Interfaces:**
- Consumes: `callReplaceAssignmentWorker` (Task 13), `useProfiles` (existing), `useAuth` (existing)
- Produces: `AssignmentSwapModal` component, invoked from `ShiftLivePage` when a manager/commander taps a dated assignment

- [ ] **Step 1: Implement the swap modal**

```typescript
// src/components/AssignmentSwapModal.tsx
import { useState } from 'react'
import { useProfiles } from '../hooks/useProfiles'
import { callReplaceAssignmentWorker } from '../lib/scheduleImports'

const QUICK_REASONS = ['לא הגיע', 'מחלה', 'החלפה']

function getReadableError(error: unknown): string {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function AssignmentSwapModal({
  assignmentId,
  onClose,
  onSaved,
}: {
  assignmentId: string
  onClose: () => void
  onSaved: () => void
}) {
  const profilesQuery = useProfiles()
  const [selectedUserId, setSelectedUserId] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!selectedUserId) {
      setError('יש לבחור מאבטח מחליף.')
      return
    }
    if (!reason.trim()) {
      setError('יש להזין סיבה.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const profile = profilesQuery.data?.find((p) => p.id === selectedUserId)
      await callReplaceAssignmentWorker({
        assignmentId,
        newUserId: selectedUserId,
        newName: profile?.full_name ?? '',
        reason: reason.trim(),
      })
      onSaved()
    } catch (err) {
      setError(getReadableError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div dir="rtl" role="dialog" className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded p-4 w-80">
        <h2 className="font-bold mb-2">החלפת מאבטח</h2>

        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="w-full mb-2 border rounded p-1">
          <option value="" disabled>
            בחר מאבטח מחליף
          </option>
          {(profilesQuery.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>

        <div className="flex gap-1 mb-2 flex-wrap">
          {QUICK_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className="border rounded px-2 py-1 text-sm">
              {r}
            </button>
          ))}
        </div>

        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="סיבה"
          className="w-full mb-2 border rounded p-1"
        />

        {error && (
          <div className="text-red-800 mb-2" role="alert">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={saving}>
            ביטול
          </button>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'שומר…' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Read `src/hooks/useProfiles.ts` first to confirm `profilesQuery.data` item shape (`id`, `full_name`) matches usage above.

- [ ] **Step 2: Wire the modal into `ShiftLivePage`**

In `src/pages/ShiftLivePage.tsx`, import `AssignmentSwapModal` and `useAuth`, add state for the currently-selected assignment id, and make the `DatedOrLegacyName` rendering (from Task 19) clickable for a manager or commander:

```typescript
import { AssignmentSwapModal } from '../components/AssignmentSwapModal'

// inside the component:
const { isAdmin, isCommander } = useAuth()
const [swapAssignmentId, setSwapAssignmentId] = useState<string | null>(null)
const canSwap = isAdmin || isCommander
```

Wrap the `DatedOrLegacyName` render sites in a clickable element when `canSwap && dated` is true, e.g.:

```tsx
{canSwap && dated ? (
  <button type="button" onClick={() => setSwapAssignmentId(dated.id)}>
    <DatedOrLegacyName ... />
  </button>
) : (
  <DatedOrLegacyName ... />
)}
```

And render the modal conditionally at the end of the component's JSX:

```tsx
{swapAssignmentId && (
  <AssignmentSwapModal
    assignmentId={swapAssignmentId}
    onClose={() => setSwapAssignmentId(null)}
    onSaved={() => setSwapAssignmentId(null)}
  />
)}
```

Confirm the exact export name for `isAdmin`/`isCommander` by re-reading `src/contexts/AuthContext.tsx` before finalizing (already confirmed present per SPEC.md §6, but exact field names must be read from source, not assumed).

- [ ] **Step 3: Manually verify realtime propagation**

With two browser sessions open (one as commander, one as a guard both viewing `/shift-live` with the flag on and a published assignment for today): in the commander session, open the swap modal, select a replacement, pick "לא הגיע", save. Confirm the guard's session updates within a few seconds without a manual refresh (via the existing Realtime subscription from Task 14's `useShiftAssignmentsForWeek`), showing the new "בפועל:" name.

- [ ] **Step 4: Manually verify commander time-window restriction**

Attempt the swap as a commander on an assignment for a different day/time window than the current one is difficult to trigger through the UI (the UI only ever shows today's live assignments) — confirm this restriction is enforced by re-running the RPC-level check from Task 11 Step 3 rather than adding new UI-level tests for it.

- [ ] **Step 5: Commit**

```bash
git add src/components/AssignmentSwapModal.tsx src/pages/ShiftLivePage.tsx
git commit -m "Add commander/manager assignment swap UI wired into ShiftLivePage"
```

---

## Task 21: End-to-end idempotency and re-upload test coverage

**Files:**
- Create: `src/lib/scheduleImport/reuploadFlow.test.ts`

**Interfaces:**
- Consumes: `normalizeSchedule`, `matchNames`, `validateSchedule` (all prior tasks) — this task tests their composition, not the DB-level idempotency (already manually verified in Task 11 Step 3)

- [ ] **Step 1: Write the composition test**

```typescript
// src/lib/scheduleImport/reuploadFlow.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeSchedule } from './normalizeSchedule'
import { matchNames } from './matchNames'
import { validateSchedule } from './validateSchedule'
import type { RawGrid } from './types'

function cell(text: string, entries: string[] = [text]) {
  return { text, entries: entries.filter((e) => e.trim().length > 0) }
}

const weekStart = new Date('2026-09-06T00:00:00.000Z')
const profiles = [{ id: 'u1', full_name: 'בדיקה־א׳' }]

function runPipeline(grid: RawGrid, existing: Parameters<typeof validateSchedule>[1] = []) {
  const { assignments: normalized } = normalizeSchedule(grid, weekStart)
  const matched = matchNames(normalized, profiles)
  return validateSchedule(matched, existing)
}

describe('re-upload composition', () => {
  it('produces an identical assignment set for two identical uploads (idempotency at the pipeline level)', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער'), cell('06:00-14:00 בדיקה־א׳')],
      ],
    }
    const first = runPipeline(grid)
    const second = runPipeline(grid)
    expect(second.assignments).toEqual(first.assignments)
    expect(second.stats).toEqual(first.stats)
  })

  it('flags a conflict for a corrected re-upload against a manually-edited existing row, but produces the same non-conflicting rows otherwise', () => {
    const grid: RawGrid = {
      rows: [
        [cell(''), cell('ראשון 06/09')],
        [cell('מאבטח')],
        [cell('שער'), cell('06:00-14:00 בדיקה־א׳')],
        [cell('שער 2'), cell('06:00-14:00 בדיקה־א׳')],
      ],
    }
    const existing = [
      { work_date: '2026-09-06', shift_category: 'morning', position: 'שער', slot_index: 0, is_manually_edited: true },
    ]
    const result = runPipeline(grid, existing)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].position).toBe('שער')
    expect(result.assignments).toHaveLength(2) // both rows still appear in the diff; only 'שער' is flagged
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm run test -- reuploadFlow`
Expected: 2 passed

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduleImport/reuploadFlow.test.ts
git commit -m "Add pipeline-level idempotency and re-upload conflict tests"
```

---

## Task 22: SPEC.md update

**Files:**
- Modify: `SPEC.md`

**Interfaces:**
- None (documentation only)

- [ ] **Step 1: Add a new section documenting the dated layer, without rewriting §3.4's existing anti-Base44 rule**

Add a new subsection after §3.2 (Hebrew, matching the doc's existing style):

```markdown
### 3.2א `shift_assignments` — שכבת שיבוץ מתוארכת (ייבוא סידור שבועי)

בנוסף ל־`roster_boards.guard_names` (שמות לא־מתוארכים, צמודים ללוח — ר' 3.1, **ללא שינוי**), נוספה טבלת `shift_assignments`: שיבוץ **מתוארך** (`work_date` × `shift_category` × `position` × `slot_index`), מיובא מקובצי Excel/PDF שבועיים דרך `/schedule-import` (מנהל בלבד, מאחורי feature flag `weekly_schedule_import`). כתיבה רק דרך RPC (`publish_schedule_import`, `replace_assignment_worker`) — אין policy כתיבה ישירה. שינויים ידניים (`is_manually_edited`) לא נדרסים בייבוא חוזר אלא אם המנהל בחר "revert_to_file" מפורשות. תיעוד מלא: [docs/superpowers/specs/2026-08-31-weekly-schedule-import-design.md](docs/superpowers/specs/2026-08-31-weekly-schedule-import-design.md).

**זה לא שובר את חוק 3.4** — `roster_boards.guard_names` נשאר מקור האמת היחיד לשמות **הלא־מתוארכים**; `shift_assignments` הוא ממד נוסף (תאריך) שלא היה קיים קודם, לא נתיב כתיבה/קריאה מקביל לאותו מידע.
```

- [ ] **Step 2: Commit**

```bash
git add SPEC.md
git commit -m "Document shift_assignments dated layer in SPEC.md"
```

---

## Task 23: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass (Tasks 2–8, 21)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: succeeds

- [ ] **Step 4: Run lint if configured**

Run: `npx eslint .` (per `eslint.config.js` present in the repo; there is no `npm run lint` script yet — add one to `package.json`: `"lint": "eslint ."`)
Expected: no errors (warnings acceptable if pre-existing)

- [ ] **Step 5: Re-run the RLS/RPC permission checks from Task 11 Step 3 one more time end-to-end**

Confirm once more, against the local stack: guard cannot call either RPC; commander can only call `replace_assignment_worker` within the current time window; manager can do everything; re-publishing an identical file is a true no-op.

- [ ] **Step 6: Manual full-flow verification**

With the flag enabled for your test manager account on the local stack: upload → preview → correct an unmatched name → publish → confirm `/shift-live` shows the dated view → perform a commander swap → confirm realtime update in a second browser session → re-upload the same file → confirm no duplicate rows and the manual swap survives.

- [ ] **Step 7: Regression check with the flag off**

Flip `weekly_schedule_import.enabled` back to `false`. Reload `/admin` and `/shift-live` and confirm both render exactly as they did before this feature existed — no new UI elements, no console errors, no behavior change.

- [ ] **Step 8: Commit any final fixes found during verification**

```bash
git add -A
git commit -m "Fix issues found during full verification pass"
```

(Only if fixes were needed — skip this step if verification passed cleanly.)

---

## Self-Review Notes

**Spec coverage:** Data model (Task 9–12), parser layer (Task 2–8), RPCs (Task 11), RLS (Task 10, 12), client integration (Task 13–20), testing (Task 2–8, 21; 15 of 15 requested scenarios covered: valid xlsx→Task 4, HTML-as-xls→Task 4, PDF-with-text→Task 7, scanned PDF→Task 7, multiple images→Task 8, unmatched name→Task 5/6, empty cell→Task 3, two workers one cell→Task 3, unusual hours→Task 3, night crossing midnight→Task 3, duplicate upload→Task 11 Step 3 + Task 21, corrected re-upload→Task 11 Step 3 + Task 21, manual-edit survives re-upload→Task 11 Step 3 + Task 21, non-manager RPC attempt→Task 11 Step 3, excluded sections never appear→Task 3), safe rollout (Task 9 Step 1, all preview-branch application steps), SPEC.md update (Task 22).

**Placeholder scan:** No TBD/TODO left in any task body. The one intentional "placeholder" is the `SchedulePreview` stub in Task 16, explicitly replaced by Task 17 in the same file — this is normal incremental build-up within one component, not a deferred unknown.

**Type consistency:** `MatchedAssignment`, `NormalizedAssignment`, `RawGrid`, `RawCell`, `ParseResult`, `ValidationWarning`, `ValidatedSchedule` are all defined once in Task 2's `types.ts` and imported (never redefined) in every subsequent task. `ShiftAssignment`/`ScheduleImportRow`/`PublishResult` are defined once in Task 13's `scheduleImports.ts`. RPC parameter names (`p_import_id`, `p_assignments`, `p_resolutions`, `p_dry_run`, `p_assignment_id`, `p_new_user_id`, `p_new_name`, `p_reason`) match exactly between Task 11's SQL and Task 13's `.rpc()` calls.
