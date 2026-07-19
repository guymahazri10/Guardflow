import { FunctionsHttpError } from '@supabase/supabase-js'
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

async function getFunctionErrorMessage(action: string, error: Error): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') {
        return `${action}: ${body.error}`
      }
    } catch {
      // fall through to generic message below
    }
  }

  return getErrorMessage(action, error)
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

export async function setUserFullName(userId: string, newFullName: string): Promise<ProfileListItem> {
  const { data, error } = await supabase.rpc('set_user_full_name', {
    target_user_id: userId,
    new_full_name: newFullName,
  })

  if (error) {
    throw new Error(getErrorMessage('Failed to update user name', error))
  }

  return data as ProfileListItem
}

export type InviteUserInput = {
  email: string
  fullName: string
  role: AppRole
}

export async function inviteUser(input: InviteUserInput): Promise<{ id: string; email: string }> {
  const redirectTo = `${window.location.origin}/accept-invite`

  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: {
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      redirectTo,
    },
  })

  if (error) {
    throw new Error(await getFunctionErrorMessage('Failed to invite user', error))
  }

  return data as { id: string; email: string }
}

export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-user', {
    body: { userId },
  })

  if (error) {
    throw new Error(await getFunctionErrorMessage('Failed to delete user', error))
  }
}
