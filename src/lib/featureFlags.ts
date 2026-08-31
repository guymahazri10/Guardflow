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
