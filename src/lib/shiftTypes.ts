import { supabase } from './supabase'
import type { ShiftCategory } from '../constants/shifts'

export type ShiftTypeRow = {
  id: string
  category: ShiftCategory
  guard_count: number
  sort_order: number
}

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

const CATEGORY_ORDER: Record<ShiftCategory, number> = { morning: 0, afternoon: 1, night: 2 }

export async function fetchShiftTypes(): Promise<ShiftTypeRow[]> {
  const { data, error } = await supabase
    .from('shift_types')
    .select('id, category, guard_count, sort_order')

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift types', error))
  }

  const rows = (data ?? []) as ShiftTypeRow[]

  // sort_order is only assigned within a category (see create_shift_type_variant),
  // so group by category first — otherwise a new variant in one category can tie
  // with, or sort after, an unrelated variant in a different category.
  return [...rows].sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.sort_order - b.sort_order)
}

export type CreateShiftTypeVariantInput = {
  category: ShiftCategory
  guardCount: number
  cloneFromShiftId: string
}

export async function createShiftTypeVariant(input: CreateShiftTypeVariantInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_shift_type_variant', {
    p_category: input.category,
    p_guard_count: input.guardCount,
    p_clone_from_shift_id: input.cloneFromShiftId,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to create shift variant', error))
  }

  return data as string
}

export async function deleteShiftTypeVariant(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_shift_type_variant', { p_shift_id: shiftId })

  if (error) {
    throw new Error(getErrorMessage('Failed to delete shift variant', error))
  }
}
