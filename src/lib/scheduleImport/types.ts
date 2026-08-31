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
