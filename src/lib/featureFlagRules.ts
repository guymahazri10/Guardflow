// Pure rules (no Supabase client), so unit tests run without environment variables.

export type FeatureFlag = {
  id: string
  enabled: boolean
  allowed_user_ids: string[]
}

/**
 * Two different questions about the same flag row:
 *
 * - isFlagAllowedFor: may THIS user use the flag's tooling (the manager-only import screens)?
 *   Governed by enabled + allowed_user_ids.
 * - isFlagEnabled: is the feature switched on at all? Governed by `enabled` only (a global kill
 *   switch). The published dated schedule on Live and Setup is read-only data every signed-in
 *   user may read (row-level security already limits non-managers to published rows), so it is
 *   gated by this, not by the allow-list that rolls out the import tooling.
 */
export function isFlagEnabled(flag: Pick<FeatureFlag, 'enabled'> | null | undefined): boolean {
  return !!flag?.enabled
}

export function isFlagAllowedFor(
  flag: Pick<FeatureFlag, 'enabled' | 'allowed_user_ids'> | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!flag?.enabled) return false
  if (flag.allowed_user_ids.length === 0) return true
  return !!userId && flag.allowed_user_ids.includes(userId)
}
