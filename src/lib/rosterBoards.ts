import { supabase } from './supabase'

export type RosterBoardRow = {
  time: string
  cells: Record<string, string>
}

export type RosterBoard = {
  id: string
  shift_id: string
  shift_type: string
  cols: string[]
  rows: RosterBoardRow[]
  notes: string | null
  published: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CreateRosterBoardInput = {
  shift_id: string
  shift_type: string
  cols: string[]
  rows: RosterBoardRow[]
  notes?: string | null
  published?: boolean
}

export type UpdateRosterBoardInput = {
  shift_id?: string
  shift_type?: string
  cols?: string[]
  rows?: RosterBoardRow[]
  notes?: string | null
  published?: boolean
}

type RosterBoardRecord = Omit<RosterBoard, 'cols' | 'rows'> & {
  cols: unknown
  rows: unknown
}

type RosterBoardWrite = {
  shift_id?: string
  shift_type?: string
  cols?: string[]
  rows?: RosterBoardRow[]
  notes?: string | null
  published?: boolean
}

const ROSTER_BOARD_SELECT =
  'id, shift_id, shift_type, cols, rows, notes, published, created_by, created_at, updated_at'

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Invalid roster_boards.${fieldName} data.`)
  }

  return value
}

function isRosterBoardRow(value: unknown): value is RosterBoardRow {
  if (!value || typeof value !== 'object') {
    return false
  }

  const row = value as { time?: unknown; cells?: unknown }

  return (
    typeof row.time === 'string' &&
    !!row.cells &&
    typeof row.cells === 'object' &&
    !Array.isArray(row.cells) &&
    Object.values(row.cells).every((cell) => typeof cell === 'string')
  )
}

function parseRosterBoardRows(value: unknown): RosterBoardRow[] {
  if (!Array.isArray(value) || !value.every(isRosterBoardRow)) {
    throw new Error('Invalid roster_boards.rows data.')
  }

  return value
}

function mapRosterBoard(record: RosterBoardRecord): RosterBoard {
  return {
    ...record,
    cols: parseStringArray(record.cols, 'cols'),
    rows: parseRosterBoardRows(record.rows),
  }
}

function mapRosterBoards(records: RosterBoardRecord[]): RosterBoard[] {
  return records.map(mapRosterBoard)
}

export async function fetchRosterBoards(): Promise<RosterBoard[]> {
  const { data, error } = await supabase
    .from('roster_boards')
    .select(ROSTER_BOARD_SELECT)
    .order('shift_type', { ascending: true })
    .order('shift_id', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch roster boards', error))
  }

  return mapRosterBoards((data ?? []) as RosterBoardRecord[])
}

export async function fetchPublishedRosterBoards(): Promise<RosterBoard[]> {
  const { data, error } = await supabase
    .from('roster_boards')
    .select(ROSTER_BOARD_SELECT)
    .eq('published', true)
    .order('shift_type', { ascending: true })
    .order('shift_id', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch published roster boards', error))
  }

  return mapRosterBoards((data ?? []) as RosterBoardRecord[])
}

export async function fetchRosterBoardById(id: string): Promise<RosterBoard | null> {
  const { data, error } = await supabase
    .from('roster_boards')
    .select(ROSTER_BOARD_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch roster board', error))
  }

  return data ? mapRosterBoard(data as RosterBoardRecord) : null
}

export async function fetchRosterBoardsByShiftId(shiftId: string): Promise<RosterBoard[]> {
  const { data, error } = await supabase
    .from('roster_boards')
    .select(ROSTER_BOARD_SELECT)
    .eq('shift_id', shiftId)
    .order('shift_type', { ascending: true })
    .order('shift_id', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch roster boards by shift id', error))
  }

  return mapRosterBoards((data ?? []) as RosterBoardRecord[])
}

export async function createRosterBoard(input: CreateRosterBoardInput): Promise<RosterBoard> {
  const payload: RosterBoardWrite = {
    shift_id: input.shift_id,
    shift_type: input.shift_type,
    cols: input.cols,
    rows: input.rows,
    notes: input.notes ?? null,
    published: input.published ?? false,
  }

  const { data, error } = await supabase
    .from('roster_boards')
    .insert(payload)
    .select(ROSTER_BOARD_SELECT)
    .single()

  if (error) {
    throw new Error(getErrorMessage('Failed to create roster board', error))
  }

  return mapRosterBoard(data as RosterBoardRecord)
}

export async function updateRosterBoard(
  id: string,
  input: UpdateRosterBoardInput,
): Promise<RosterBoard> {
  const payload: RosterBoardWrite = {
    ...input,
  }

  const { data, error } = await supabase
    .from('roster_boards')
    .update(payload)
    .eq('id', id)
    .select(ROSTER_BOARD_SELECT)
    .single()

  if (error) {
    throw new Error(getErrorMessage('Failed to update roster board', error))
  }

  return mapRosterBoard(data as RosterBoardRecord)
}

export async function publishRosterBoard(id: string, published: boolean): Promise<RosterBoard> {
  const { data, error } = await supabase
    .from('roster_boards')
    .update({ published })
    .eq('id', id)
    .select(ROSTER_BOARD_SELECT)
    .single()

  if (error) {
    throw new Error(getErrorMessage('Failed to publish roster board', error))
  }

  return mapRosterBoard(data as RosterBoardRecord)
}

export async function deleteRosterBoard(id: string): Promise<void> {
  const { error } = await supabase.from('roster_boards').delete().eq('id', id)

  if (error) {
    throw new Error(getErrorMessage('Failed to delete roster board', error))
  }
}
