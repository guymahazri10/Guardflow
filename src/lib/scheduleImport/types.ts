export type FileKind = 'xlsx' | 'xls-html' | 'pdf' | 'unknown'

export type ShiftCategory = 'morning' | 'afternoon' | 'night'
export type WorkerKind = 'אחמ"ש' | 'מאבטח'

export type RawCell = {
  text: string
  entries: string[] // one raw cell can hold multiple stacked worker lines
  /** Column span of the source cell, set only when > 1. A group header row
   *  ("בקרה", "מאבטח") spans the whole table; a real position row never does. */
  colspan?: number
}

export type RawGrid = {
  rows: RawCell[][]
}

export type ParseResult =
  | { supported: true; grid: RawGrid; warnings?: ValidationWarning[] }
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
  kind:
    | 'unmatched_name'
    | 'duplicate_slot'
    | 'empty_cell_skipped'
    | 'conflict_with_existing'
    | 'low_confidence_ocr'
    | 'week_mismatch'
    | 'double_booked'
    // The same NAME (not a linked account) appears in overlapping shifts. With
    // no user link it may be two different people, so this never blocks.
    | 'possible_double_booking'
    // A מאבטח row's label didn't resolve to exactly one canonical position,
    // and isn't the one supported non-physical role label either (see
    // positions.ts's resolveGuardPosition). The assignment is still
    // extracted (position = the raw label, never invented) so the manager
    // sees it in the preview, but publish must be blocked until a human
    // decides the real mapping.
    | 'unresolved_position_mapping'
    // The one supported non-physical role label (NIGHT_GUARD_LABEL,
    // "לילה מאבטח") received more names on one day than its known capacity
    // (currently 1) — a real crew-size mismatch, never silently dropped to
    // fit; publish is blocked until a human resolves who the extra person
    // actually is.
    | 'position_capacity_mismatch'
    // A shift's own hours fall outside the window its category implies (e.g. a
    // morning row that runs 06:30-19:00). The original hours are kept and
    // shown; nothing is normalized. Needs the manager's explicit confirmation.
    | 'unusual_shift_hours'
    // A single shift longer than a plausible working shift. Same handling.
    | 'unusual_shift_duration'
    // A group header the importer doesn't recognize — its rows are not
    // classified (neither imported nor silently dropped) and are surfaced here.
    | 'unknown_section'
    // The row label carries no morning/afternoon/night word, so the category
    // had to be guessed from the start hour alone.
    | 'category_guessed_from_hours'
  message: string
  work_date?: string
  position?: string
  shift_category?: ShiftCategory
  slot_index?: number
  /** Original hours as read from the file ("HH:MM-HH:MM"), for the warnings above. */
  original_hours?: string
}

/** Kinds that must be explicitly acknowledged by the manager before publish. */
export const ACK_REQUIRED_WARNING_KINDS: ValidationWarning['kind'][] = [
  'unusual_shift_hours',
  'unusual_shift_duration',
  'unknown_section',
  'category_guessed_from_hours',
]

export type ExcludedGroupSummary = { section: string; reason: string; count: number }

/** What the importer did with the file, for the preview's counts. */
export type NormalizeSummary = {
  included: number
  excluded: ExcludedGroupSummary[]
  /** Day cells of an included row that held no worker. */
  emptyCells: number
}

export type ValidatedSchedule = {
  assignments: MatchedAssignment[]
  warnings: ValidationWarning[]
  conflicts: MatchedAssignment[]
  stats: { imported: number; skipped: number; unmatched_names: number }
}
