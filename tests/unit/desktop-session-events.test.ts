import { describe, it, expect } from 'vitest'
import {
  sessionEventAction,
  claimNavigationSlot,
  NAV_WINDOW_MS,
  NAV_MAX_IN_WINDOW,
  type StoredSession,
} from '@/lib/desktop-session'

// Regression guards for "the desktop app loses the session on reload / restart".
//
// Found 2026-10-04 by driving the real Tauri shell: the bridge treated EVERY
// auth event without a session as a sign-out and deleted the stored session.
// supabase-js sends INITIAL_SESSION to each new listener straight away, and a
// freshly launched desktop webview (or a reload that lost its cookie) has no
// session in the document yet — so session.json was deleted on every such
// page load, before the restore could read it. These tests pin the rule.

const SESSION: StoredSession = { access_token: 'a', refresh_token: 'r' }

describe('sessionEventAction — what the bridge does with a Supabase auth event', () => {
  it('does NOT clear the stored session on INITIAL_SESSION with no session (the bug)', () => {
    expect(sessionEventAction('INITIAL_SESSION', null)).toBe('ignore')
  })

  it('saves the session when INITIAL_SESSION has one, so the file follows a server-side refresh', () => {
    expect(sessionEventAction('INITIAL_SESSION', SESSION)).toBe('save')
  })

  it.each(['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'])('saves on %s', (event) => {
    expect(sessionEventAction(event, SESSION)).toBe('save')
  })

  it('clears only on a real SIGNED_OUT', () => {
    expect(sessionEventAction('SIGNED_OUT', null)).toBe('clear')
  })

  it('never clears on any other event that merely carries no session', () => {
    for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY', 'MFA_CHALLENGE_VERIFIED', 'whatever-supabase-adds-next']) {
      expect(sessionEventAction(event, null)).not.toBe('clear')
    }
  })
})

describe('claimNavigationSlot — the bounce-loop guard for automatic navigation', () => {
  const T = 1_000_000

  it('allows the first navigation and records it', () => {
    expect(claimNavigationSlot(null, T)).toEqual({ allowed: true, next: [T] })
  })

  it('treats unreadable or legacy history as empty (the previous build stored a bare "1")', () => {
    for (const legacy of [1, '1', {}, 'x', undefined, [null, 'a', {}]]) {
      expect(claimNavigationSlot(legacy, T).allowed).toBe(true)
    }
  })

  it(`allows up to ${NAV_MAX_IN_WINDOW} navigations inside the window, then blocks — a loop dies in seconds`, () => {
    let history: number[] = []
    const outcomes: boolean[] = []
    for (let i = 0; i < 5; i++) {
      const r = claimNavigationSlot(history, T + i * 100)
      outcomes.push(r.allowed)
      history = r.next
    }
    expect(outcomes).toEqual([true, true, false, false, false])
  })

  it('a blocked claim does not extend the window, so the guard cannot lock the app out for good', () => {
    const blocked = claimNavigationSlot([T, T + 1], T + 2)
    expect(blocked.allowed).toBe(false)
    expect(blocked.next).toEqual([T, T + 1])
  })

  it('lets a LATER reload restore and navigate again — the case a once-per-session guard broke', () => {
    // launch used a slot, then a reload a minute later needs another
    const afterLaunch = claimNavigationSlot(null, T).next
    expect(claimNavigationSlot(afterLaunch, T + NAV_WINDOW_MS + 1).allowed).toBe(true)
    expect(claimNavigationSlot(afterLaunch, T + 60_000).allowed).toBe(true)
  })

  it('a launch plus ONE reload inside the window is still allowed (restore -> navigate -> restore -> navigate)', () => {
    const first = claimNavigationSlot(null, T)
    expect(claimNavigationSlot(first.next, T + 3_000).allowed).toBe(true)
  })

  it('ignores timestamps from the future (a clock change) instead of counting them forever', () => {
    expect(claimNavigationSlot([T + 10_000_000, T + 10_000_001], T).allowed).toBe(true)
  })
})
