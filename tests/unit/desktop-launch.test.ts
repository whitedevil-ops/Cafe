import { describe, it, expect } from 'vitest'
import { decideLaunch, signedInTarget, isEntryPath } from '@/lib/desktop-launch'

const at = (pathname: string, search = '') => ({ pathname, search })

describe('decideLaunch', () => {
  it('takes a restored session off the marketing homepage to the dashboard', () => {
    // The bug this was written for: the Tauri window opens at "/", the session
    // restored fine, and location.reload() re-rendered the marketing page.
    expect(decideLaunch({ ...at('/'), hasSession: false, restored: true })).toEqual({
      kind: 'replace',
      to: '/dashboard',
    })
  })

  it('takes an already-live session off the homepage too', () => {
    expect(decideLaunch({ ...at('/'), hasSession: true, restored: false })).toEqual({
      kind: 'replace',
      to: '/dashboard',
    })
  })

  it('sends a signed-out launch to the login form, not the marketing page', () => {
    expect(decideLaunch({ ...at('/'), hasSession: false, restored: false })).toEqual({
      kind: 'replace',
      to: '/login',
    })
  })

  it('leaves a signed-out café already on /login alone', () => {
    expect(decideLaunch({ ...at('/login'), hasSession: false, restored: false })).toEqual({
      kind: 'stay',
    })
  })

  it('honours ?next= so a deep link that bounced through /login still arrives', () => {
    expect(
      decideLaunch({ ...at('/login', '?next=/dashboard/pos'), hasSession: false, restored: true }),
    ).toEqual({ kind: 'replace', to: '/dashboard/pos' })
  })

  it('reloads in place when a session is restored somewhere real', () => {
    // The document was rendered signed-out, so it has to be fetched again —
    // but the café was on this page on purpose, so don't move them.
    expect(decideLaunch({ ...at('/dashboard/pos'), hasSession: false, restored: true })).toEqual({
      kind: 'reload',
    })
  })

  it('does nothing when a live session is already on a real page', () => {
    expect(decideLaunch({ ...at('/dashboard/pos'), hasSession: true, restored: false })).toEqual({
      kind: 'stay',
    })
  })

  it('never routes away from a page the café navigated to itself', () => {
    for (const p of ['/dashboard', '/pricing', '/blog', '/onboarding', '/dashboard/reports']) {
      const action = decideLaunch({ ...at(p), hasSession: false, restored: false })
      expect(action, p).toEqual({ kind: 'stay' })
    }
  })
})

describe('signedInTarget', () => {
  it('defaults to the dashboard', () => {
    expect(signedInTarget('')).toBe('/dashboard')
    expect(signedInTarget('?foo=bar')).toBe('/dashboard')
  })

  it('accepts a same-origin path', () => {
    expect(signedInTarget('?next=/dashboard/bills')).toBe('/dashboard/bills')
  })

  it('rejects a protocol-relative URL rather than treating it as a path', () => {
    expect(signedInTarget('?next=//evil.example')).toBe('/dashboard')
  })

  it('rejects an absolute URL', () => {
    expect(signedInTarget('?next=https://evil.example/x')).toBe('/dashboard')
  })
})

describe('isEntryPath', () => {
  it('covers exactly the two places the app can open on', () => {
    expect(isEntryPath('/')).toBe(true)
    expect(isEntryPath('/login')).toBe(true)
    expect(isEntryPath('/dashboard')).toBe(false)
    expect(isEntryPath('/login/reset')).toBe(false)
  })
})
