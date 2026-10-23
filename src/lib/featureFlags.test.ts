import { describe, expect, it } from 'vitest'
import { isFlagAllowedFor, isFlagEnabled } from './featureFlags'

describe('feature flag rules', () => {
  const rolledOutToManagerOnly = { enabled: true, allowed_user_ids: ['manager'] }

  it('the import tooling stays limited to the allow-list', () => {
    expect(isFlagAllowedFor(rolledOutToManagerOnly, 'manager')).toBe(true)
    expect(isFlagAllowedFor(rolledOutToManagerOnly, 'guard')).toBe(false)
    expect(isFlagAllowedFor(rolledOutToManagerOnly, null)).toBe(false)
    expect(isFlagAllowedFor({ enabled: true, allowed_user_ids: [] }, 'anyone')).toBe(true)
  })

  it('showing the published schedule on Live and Setup depends only on the global switch, not on the allow-list', () => {
    expect(isFlagEnabled(rolledOutToManagerOnly)).toBe(true)
    expect(isFlagEnabled({ enabled: false })).toBe(false)
    expect(isFlagEnabled(null)).toBe(false)
  })

  it('a switched-off flag disables everything', () => {
    expect(isFlagAllowedFor({ enabled: false, allowed_user_ids: [] }, 'manager')).toBe(false)
  })
})
