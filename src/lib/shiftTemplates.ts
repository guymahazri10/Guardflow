import { supabase } from './supabase'
import type { RosterBoardRow } from './rosterBoards'

export type ShiftTemplate = {
  id: string
  shift_id: string
  cols: string[]
  rows: RosterBoardRow[]
  notes: string | null
  updated_at: string
}

export type UpdateShiftTemplateInput = {
  cols: string[]
  rows: RosterBoardRow[]
  notes?: string | null
}

type ShiftTemplateRecord = Omit<ShiftTemplate, 'cols' | 'rows'> & {
  cols: unknown
  rows: unknown
}

const SHIFT_TEMPLATE_SELECT = 'id, shift_id, cols, rows, notes, updated_at'

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Invalid shift_templates.${fieldName} data.`)
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

function parseRows(value: unknown): RosterBoardRow[] {
  if (!Array.isArray(value) || !value.every(isRosterBoardRow)) {
    throw new Error('Invalid shift_templates.rows data.')
  }

  return value
}

function mapShiftTemplate(record: ShiftTemplateRecord): ShiftTemplate {
  return {
    ...record,
    cols: parseStringArray(record.cols, 'cols'),
    rows: parseRows(record.rows),
  }
}

export async function fetchShiftTemplates(): Promise<ShiftTemplate[]> {
  const { data, error } = await supabase
    .from('shift_templates')
    .select(SHIFT_TEMPLATE_SELECT)
    .order('shift_id', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift templates', error))
  }

  return (data ?? []).map((record) => mapShiftTemplate(record as ShiftTemplateRecord))
}

export async function fetchShiftTemplateByShiftId(shiftId: string): Promise<ShiftTemplate | null> {
  const { data, error } = await supabase
    .from('shift_templates')
    .select(SHIFT_TEMPLATE_SELECT)
    .eq('shift_id', shiftId)
    .maybeSingle()

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift template', error))
  }

  return data ? mapShiftTemplate(data as ShiftTemplateRecord) : null
}

export async function updateShiftTemplate(
  shiftId: string,
  input: UpdateShiftTemplateInput,
): Promise<ShiftTemplate> {
  const { data, error } = await supabase
    .from('shift_templates')
    .update({ cols: input.cols, rows: input.rows, notes: input.notes ?? null })
    .eq('shift_id', shiftId)
    .select(SHIFT_TEMPLATE_SELECT)
    .single()

  if (error) {
    throw new Error(getErrorMessage('Failed to update shift template', error))
  }

  return mapShiftTemplate(data as ShiftTemplateRecord)
}
