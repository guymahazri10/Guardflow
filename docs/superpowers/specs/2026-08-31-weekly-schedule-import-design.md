# Weekly schedule import — design spec

**Date:** 2026-08-31
**Status:** approved, pending implementation plan
**Branch:** new branch off `main` (`feature/weekly-schedule-import`)

## Problem

Today a manager builds each shift board by hand in `/admin` → `/roster-editor`, and staffing (`roster_boards.guard_names`) is a single name per role **column**, not per date — SPEC.md §3.4 states this explicitly ("שמות נצמדים ללוח, לא לתאריך"). The organization already produces a weekly schedule externally (Excel/PDF/photo) and re-typing it into GuardFlow is slow and error-prone.

We need to let a manager upload that weekly file, see a reviewable preview, and publish it as **dated** staffing — without touching the existing non-dated `roster_boards.guard_names` flow (Setup screen, `PositionChangeNotifier`, the `reset-shift-names` cron all keep working exactly as they do today), and without breaking the anti-Base44 rule (one editable place per kind of data, not two silently-diverging ones).

Import formats: `.xls`/`.xlsx` (preferred, most accurate), `.pdf` (text-layer only in this phase — scanned PDF explicitly deferred), image upload/capture **deferred to phase 2** (no OCR/Vision capability exists in this project yet; see Open Questions). Only the "אחמ״ש" and "מאבטח" sections of the source file are imported; every other section (בקרה / היעדרויות / חופש / מחלה / מילואים / קורס / לימודים / תגבור) is discarded before it ever reaches storage, a preview, or a warning.

## Data model

`roster_boards` is untouched. It remains the source of truth for **template structure** (time-of-day categories, role columns) and for the existing non-dated `guard_names`. This import feature adds a new, separate, **dated** layer:

```sql
create table public.schedule_imports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,               -- Sunday of the imported week
  source_kind text not null check (source_kind in ('excel', 'pdf', 'image')),
  storage_path text not null,             -- private bucket path
  original_filename text not null,
  content_hash text not null,             -- sha256 of the raw file bytes
  status text not null default 'processing'
    check (status in ('processing', 'ready_for_review', 'published', 'failed', 'cancelled')),
  stats jsonb not null default '{}',      -- {imported: n, skipped: n, unmatched_names: n}
  parse_warnings jsonb not null default '[]',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, content_hash)       -- re-uploading the identical file is a no-op
);

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift_category text not null check (shift_category in ('morning', 'afternoon', 'night')),
  worker_kind text not null check (worker_kind in ('אחמ"ש', 'מאבטח')),
  position text not null,                 -- עמדה, free text as read from the file
  slot_index int not null default 0,      -- 0-based, for >1 worker at the same position
  starts_at timestamptz not null,
  ends_at timestamptz not null,           -- may be on work_date + 1 (night shift)
  source_name text,                       -- name exactly as it appeared in the file
  planned_user_id uuid references public.profiles(id),  -- resolved match, if any
  actual_user_id uuid references public.profiles(id),    -- who is actually staffed now
  actual_name text,                       -- display fallback when actual_user_id is null
  source text not null default 'excel' check (source in ('excel', 'pdf', 'image', 'manual')),
  import_id uuid references public.schedule_imports(id),
  is_manually_edited boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_date, shift_category, position, slot_index)
);

create table public.staffing_change_log (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  from_user_id uuid references public.profiles(id),
  from_name text,
  to_user_id uuid references public.profiles(id),
  to_name text,
  reason text,
  change_kind text not null check (change_kind in ('manual_replace', 'import_update', 'import_kept_manual', 'import_revert_to_file')),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

create table public.app_feature_flags (
  id text primary key,
  enabled boolean not null default false,
  allowed_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into app_feature_flags (id, enabled, allowed_user_ids) values ('weekly_schedule_import', false, '{}');
```

The identity key `(work_date, shift_category, position, slot_index)` is what makes re-upload idempotent: a second upload of the same week's (possibly corrected) file re-resolves to the same rows rather than creating duplicates.

**Storage:** new private bucket `schedule-imports`. Path convention `{week_start}/{import_id}/{safe_filename}`. No public access; signed URLs only, issued to managers.

## Parser layer — `src/lib/scheduleImport/`

Pure functions, no I/O, so each is independently unit-testable:

- **`detectFileKind(bytes): 'xlsx' | 'xls-html' | 'pdf' | 'unknown'`** — sniffs magic bytes, never trusts the extension: `PK\x03\x04` → real xlsx (zip), `\xD0\xCF\x11\xE0` → real legacy `.xls` (OLE2/BIFF), `%PDF` → pdf, otherwise sniff for `<html`/`<table` (case-insensitive, allowing leading whitespace/BOM) → HTML masquerading as `.xls`. This directly satisfies the "some `.xls` files are actually HTML" requirement.
- **`parseExcelSchedule(bytes, kind): RawGrid`** — for real xlsx/xls, uses `xlsx` (SheetJS, MIT-licensed, no paid dependency) to read cells with merge (`rowSpan`/`colSpan`) info. For HTML-as-xls, parses the DOM (`DOMParser`) and walks `<table>`/`<tr>`/`<td>` directly, respecting `rowspan`/`colspan` attributes. Both paths converge on the same `RawGrid` shape: a 2D array of cells, each cell holding `{ text: string, entries: string[] }` (one raw cell can contain multiple stacked worker lines — split on newlines/`<br>`).
- **`parsePdfSchedule(bytes): RawGrid`** — uses `pdfjs-dist`'s text layer (`getTextContent`), clusters text items into rows/columns by X/Y position to reconstruct a grid. If the extracted text is empty or below a density threshold, returns `{ supported: false, reason: 'סרוק — לא נתמך בשלב זה' }` rather than guessing.
- **`parseImageSchedule(bytes[]): ParseResult`** — phase-1 stub: always returns `{ supported: false, reason: '...' }`. Phase 2 fills this in without touching any other module (see Open Questions).
- **`normalizeSchedule(grid: RawGrid, weekStart: Date): NormalizedAssignment[]`** — the allowlist filter lives here: only rows/sections identified as "אחמ״ש" or "מאבטח" survive; the 8 excluded section labels (and any row that doesn't map to a recognized worker-kind + position + time) are dropped **before** they leave this function — never persisted, never previewed, never surfaced as a warning, per the requirement. For each surviving cell: parses date/day-of-week from the header row, shift category from the row's time label, start/end time **from the cell's own text** (not assumed from category defaults — this directly satisfies the requirement that hours must come from the cell, including partial/unusual hours and night shifts crossing midnight, where `ends_at` gets `work_date + 1`), and `slot_index` for stacked entries in one cell.
- **`matchNames(assignments, profiles): NormalizedAssignment[]`** — Hebrew-aware fuzzy match: NFC-normalize, strip Hebrew geresh/gershayim/quote variants (`׳ ״ ' " ' '`), collapse whitespace, then exact match first; if none, Levenshtein distance ≤ 2 as a **suggestion only** (never auto-applied — the manager must confirm in the preview). Unmatched names are surfaced with a "בחר עובד קיים" affordance, never silently dropped.
- **`validateSchedule(assignments, existing): { assignments, warnings, conflicts, stats }`** — flags: empty cells (skipped, not an error), duplicate `(work_date, shift_category, position, slot_index)` within the same file (data problem, surfaced), diffs against existing published assignments for the week (`conflicts`, only relevant on re-upload), and the assignment/skip counters the preview screen needs.

**Where each runs:**
- Excel path runs **client-side** in the browser (fast, avoids uploading the file before the manager has even seen a preview) using the same pure modules.
- PDF path runs **server-side**, in a new edge function `parse-schedule`, per the requirement that PDF/image processing must not be browser-only. This also means the door to phase-2 OCR is already the right shape — swapping the stub in `parseImageSchedule` is the only change needed there.
- Both call the exact same `normalizeSchedule`/`matchNames`/`validateSchedule` — one shared pipeline, not two divergent ones.

## Write path — two RPCs, nothing else can write

**`publish_schedule_import(p_import_id uuid, p_assignments jsonb, p_resolutions jsonb, p_dry_run boolean)`**
- `security definer`, manager-only (checked via `get_my_role()`).
- `p_dry_run = true`: computes and returns the diff (to-insert / to-update / to-skip-because-manually-edited / conflicts) without writing anything — this is the preview screen's data source, and also the safe way to test the feature against real data before ever publishing.
- `p_dry_run = false`: upserts on the identity key. Any existing row with `is_manually_edited = true` is **left untouched** unless `p_resolutions` explicitly says `revert_to_file` for that row (chosen by the manager in the UI when a conflict is shown) — logged as `import_revert_to_file`; otherwise logged as `import_kept_manual`. Rows from a prior import for the same week that are no longer present in the new file **and were never manually edited** are deleted; manually-edited rows are never deleted by an import. Sets `schedule_imports.status = 'published'`.
- Because the upsert key is stable, uploading the identical file twice produces zero changes the second time (true idempotency), not just "no duplicate rows."

**`replace_assignment_worker(p_assignment_id uuid, p_new_user_id uuid, p_new_name text, p_reason text)`**
- `security definer`. Manager: any assignment. Commander (אחמ"ש): only where `work_date` is today (or the shift crosses midnight and today falls within `[starts_at, ends_at)`), per your decision to scope commander edits to the live shift.
- Records `from_user_id`/`from_name` from the current row, updates `actual_user_id`/`actual_name`, sets `is_manually_edited = true`, writes a `staffing_change_log` row (`change_kind = 'manual_replace'`, `reason`, `changed_by`, `changed_at`).
- This is the only way `shift_assignments.actual_*` ever changes outside an import.

## RLS

| Table | SELECT | Write |
|---|---|---|
| `schedule_imports` | manager only | manager only (direct insert/update ok — no RPC needed, low-risk metadata) |
| `shift_assignments` | any `authenticated`, but rows with `published = false` are manager-only | **no direct INSERT/UPDATE/DELETE policy for anyone** — only the two `security definer` RPCs touch this table, which by construction blocks any client from bypassing validation via raw REST calls |
| `staffing_change_log` | manager + commander | none (RPC-only, via `replace_assignment_worker`) |
| `app_feature_flags` | any `authenticated` (client needs to read it to gate the UI) | manager only |

Storage bucket `schedule-imports`: private, RLS policies restricting all operations to manager role, mirroring the existing `push_subscriptions`-style per-table RLS pattern already in this codebase.

## Client-side integration

**New route** `/schedule-import` (under `AdminRoute`), plus a new card "ייבוא סידור שבועי" on `AdminPanelPage` — both conditionally rendered only when `app_feature_flags['weekly_schedule_import']` is enabled for the current user (`enabled && (allowed_user_ids is empty OR contains user.id)`), read via a new `useFeatureFlag` hook.

**Import wizard flow** (`ScheduleImportPage.tsx`):
1. **Upload** — file picker restricted to `.xls,.xlsx,.pdf` (image capture UI deferred to phase 2, see below), drag-and-drop supported, shows filename/size before submitting.
2. **Processing** — non-blocking: the wizard shows a progress state while `parseExcelSchedule` (client) or the `parse-schedule` edge function (PDF) runs; the rest of the admin screen stays usable in another tab, this isn't a modal blocking the whole app.
3. **Preview** — table grouped by day, showing per assignment: date, day name, shift category, worker kind, position, planned start/end, source name, matched/unmatched status. Manager actions per row: edit name, pick existing profile from a searchable select, remove the row. Header summary: detected week, "ייקלטו: N", "דולגו: M", conflict/duplicate badges. "ביטול" discards everything (nothing was written yet — `publish_schedule_import` hasn't been called). "פרסם" calls `publish_schedule_import(..., dry_run: false)`.
4. Nothing is written to `shift_assignments` before that final "פרסם" click — the dry-run call backs the preview table itself, so what the manager sees **is** what a real publish would do.

**ShiftLivePage integration:** when the flag is on and a `shift_assignments` row exists for the current date/category/position, the live view shows "מתוכנן: X" / "בפועל: Y" / "עודכן על ידי Z בשעה HH:MM" (from the latest `staffing_change_log` entry for that assignment) instead of the current single name. When the flag is off, or no dated assignment exists for today, `ShiftLivePage` renders exactly as it does today from `roster_boards.guard_names` — zero behavior change for anyone not opted into the flag. `useActiveBoard` gains a second, independent Realtime subscription on `shift_assignments` (separate channel, separate table) alongside its existing `roster_boards` one; it does not touch the existing subscription logic.

**Commander swap UI:** on the live view, a manager or commander can tap an assignment (only if it's today's, for a commander) → pick a replacement from the existing profiles list → enter a short reason (free text, "לא הגיע"/"מחלה"/"החלפה" as quick-pick chips plus free text) → save → `replace_assignment_worker` → Realtime pushes the update to every connected client immediately, same mechanism as today's `guard_names` updates.

## Testing

No test runner exists yet (`tsc -b` inside `npm run build` is the only current safety net). This feature adds **Vitest** as a devDependency plus `npm run test`/`npm run typecheck` scripts — pure-function-first design (parsers, normalizer, matcher) makes this cheap and doesn't touch the existing build tooling.

All fixtures are synthetic, clearly-labeled test data (e.g. names like `בדיקה־א׳`, `בדיקה־ב׳`), never real personnel. Coverage required per the request:
1. Valid `.xlsx`
2. `.xls` that is actually HTML
3. PDF with a text layer
4. Scanned PDF (asserts graceful "not supported" outcome, not a crash or bad guess)
5. Multiple images for one week (phase-2 stub: asserts `{supported:false}`)
6. Unmatched name → surfaced for manual resolution, not silently dropped or auto-assigned
7. Empty cell → skipped, not an error
8. Two workers in one cell/position → two rows via `slot_index`
9. Unusual/partial hours read from the cell, not defaulted
10. Night shift crossing midnight → `ends_at` on `work_date + 1`
11. Duplicate upload of the identical file (same `content_hash`) → no new rows, no error
12. Corrected re-upload for the same week → diff computed correctly
13. Manually-edited assignment survives a subsequent re-upload
14. Non-manager attempting the RPCs → rejected (`42501`-equivalent)
15. Excluded sections (בקרה/היעדרויות/חופש/מחלה/מילואים/קורס/לימודים/תגבור) never appear in output, warnings, or DB rows

## Safe rollout path

1. New git branch `feature/weekly-schedule-import` off `main`.
2. New **Supabase preview branch** (per your decision) — migrations, RPCs, and the new bucket are created there first; nothing in this feature touches the production project until you explicitly say so.
3. All migrations are additive (`create table`, `create policy`, `insert` one flag row) — no `alter`/`drop` on any existing table, no data touched.
4. `app_feature_flags.weekly_schedule_import` starts `enabled = false`; even after merging to `main` and running the migration against production, the feature is invisible until you flip it on for your own `allowed_user_ids` first.
5. `publish_schedule_import`'s `dry_run` mode doubles as a built-in "read and preview without writing" mode for validating the parser against your real weekly file before ever publishing.

## Open questions / explicitly deferred (confirmed with you already)

- **Image / camera capture and scanned-PDF OCR are deferred to phase 2.** No OCR/Vision capability or API key exists in this project today; adding one is a paid external dependency and requires your separate, explicit sign-off (per your standing instruction not to add paid services without approval). Phase 1 ships Excel + text-layer PDF only; the parser architecture (`parseImageSchedule` stub, the `ParseResult.supported` shape) is already built so phase 2 is additive, not a rework.
- **Sample file:** no real weekly schedule file was available at design time. The parser is built against the structural description in the request (date header row, worker-kind/section grouping, position rows, stacked multi-worker cells) and the excluded-section list. Once a real (or realistic synthetic) file is provided, `detectFileKind`/`parseExcelSchedule`/`normalizeSchedule` will be checked and adjusted against its actual layout before this feature is considered done — this is called out explicitly in the implementation plan as a required verification step, not an assumption to skip.
