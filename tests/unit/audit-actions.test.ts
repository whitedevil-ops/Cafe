import { describe, it, expect } from 'vitest'
import { auditLabel, auditTone, relativeTime } from '@/lib/audit-actions'

describe('auditLabel', () => {
  it('renders a sentence for known actions, not the machine name', () => {
    expect(auditLabel('cafe.status_changed')).toBe('Café status changed')
    expect(auditLabel('admin.password_reset_initiated')).toBe('Admin password reset sent')
  })

  it('falls back readably for an action nobody has mapped yet', () => {
    // A migration can add an action before this file knows about it; it must
    // still render as words rather than vanish or show the raw identifier.
    expect(auditLabel('cafe.some_future_thing')).toBe('Some future thing')
  })

  it('never returns an empty string', () => {
    for (const a of ['cafe.verified', 'x.y', 'weird']) expect(auditLabel(a).length).toBeGreaterThan(0)
  })
})

describe('auditTone', () => {
  it('marks destructive actions distinctly from routine ones', () => {
    expect(auditTone('admin.password_reset_initiated')).toBe('destructive')
    expect(auditTone('cafe.note_added')).toBe('neutral')
    expect(auditTone('cafe.verified')).toBe('success')
  })

  it('defaults unknown actions to neutral rather than alarming', () => {
    expect(auditTone('cafe.some_future_thing')).toBe('neutral')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-08-12T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it('handles the sub-minute case', () => {
    expect(relativeTime(ago(30_000), now)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago')
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago')
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d ago')
  })

  it('gives up past a week so the caller shows a real date instead', () => {
    expect(relativeTime(ago(8 * 86_400_000), now)).toBeNull()
  })

  it('returns null for a future timestamp rather than a negative age', () => {
    // Clock skew between the DB and the browser is real and should not render
    // as "-3m ago".
    expect(relativeTime(new Date(now.getTime() + 60_000).toISOString(), now)).toBeNull()
  })

  it('returns null for an unparseable value', () => {
    expect(relativeTime('not a date', now)).toBeNull()
  })
})
