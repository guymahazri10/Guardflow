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

export async function fetchShiftTypes(): Promise<ShiftTypeRow[]> {
  const { data, error } = await supabase
    .from('shift_types')
    .select('id, category, guard_count, sort_order')
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch shift types', error))
  }

  return (data ?? []) as ShiftTypeRow[]
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
