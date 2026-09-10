import { describe, it, expect } from 'vitest'
import { isBlocked } from '@/components/desktop-route-guard'

describe('isBlocked', () => {
  it('blocks the registration entry points', () => {
    expect(isBlocked('/signup')).toBe(true)
    expect(isBlocked('/get-started')).toBe(true)
  })

  it('blocks onboarding, including a mid-wizard sub-path', () => {
    expect(isBlocked('/onboarding')).toBe(true)
    expect(isBlocked('/onboarding/cafe')).toBe(true)
  })

  it('does not prefix-match an unrelated path that merely starts the same way', () => {
    // The exact trap /r vs /reset-password already hit once (see robots.ts) —
    // a bare startsWith('/onboard') would also match a hypothetical
    // '/onboarding-guide' marketing page.
    expect(isBlocked('/onboarding-guide')).toBe(false)
    expect(isBlocked('/get-started-guide')).toBe(false)
  })

  it('leaves login, dashboard and marketing pages alone', () => {
    expect(isBlocked('/login')).toBe(false)
    expect(isBlocked('/dashboard')).toBe(false)
    expect(isBlocked('/dashboard/pos')).toBe(false)
    expect(isBlocked('/')).toBe(false)
    expect(isBlocked('/pricing')).toBe(false)
  })
})
