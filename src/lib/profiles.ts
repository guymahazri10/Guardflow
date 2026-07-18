import { supabase } from './supabase'
import type { AppRole } from '../contexts/AuthContext'

export type ProfileListItem = {
  id: string
  email: string | null
  full_name: string | null
  app_role: AppRole | string | null
  created_at: string
  updated_at: string
}

const PROFILE_SELECT = 'id, email, full_name, app_role, created_at, updated_at'

function getErrorMessage(action: string, error: { message?: string }) {
  return `${action}: ${error.message ?? 'Supabase request failed.'}`
}

export async function fetchProfiles(): Promise<ProfileListItem[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .order('full_name', { ascending: true })

  if (error) {
    throw new Error(getErrorMessage('Failed to fetch profiles', error))
  }

  return (data ?? []) as ProfileListItem[]
}

export async function setUserAppRole(userId: string, newRole: AppRole): Promise<ProfileListItem> {
  const { data, error } = await supabase.rpc('set_user_app_role', {
    target_user_id: userId,
    new_role: newRole,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to update user role', error))
  }

  return data as ProfileListItem
}
