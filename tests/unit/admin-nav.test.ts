import { describe, it, expect } from 'vitest'
import { isActive } from '@/components/ops/sidebar-nav'

// The console root is /ops, so "does this nav item match the
// current URL" is the one place this can go wrong: a naive startsWith marks
// Overview active on every screen, and an over-strict equals means a café
// detail page lights up nothing at all.

describe('isActive', () => {
  it('marks Overview active only at the console root', () => {
    expect(isActive('/ops', '/ops')).toBe(true)
    expect(isActive('/ops/cafes', '/ops')).toBe(false)
    expect(isActive('/ops/audit-logs', '/ops')).toBe(false)
  })

  it('keeps a section active on its own detail pages', () => {
    expect(isActive('/ops/cafes', '/ops/cafes')).toBe(true)
    expect(isActive('/ops/cafes/abc-123', '/ops/cafes')).toBe(true)
  })

  it('does not light up a sibling section', () => {
    expect(isActive('/ops/cafes', '/ops/users')).toBe(false)
    expect(isActive('/ops/health', '/ops/audit-logs')).toBe(false)
  })

  it('leaves exactly one item active on every real console path', () => {
    const hrefs = [
      '/ops',
      '/ops/cafes',
      '/ops/users',
      '/ops/leads',
      '/ops/health',
      '/ops/audit-logs',
      '/ops/admins',
    ]
    const paths = [...hrefs, '/ops/cafes/abc-123']

    for (const path of paths) {
      const matches = hrefs.filter((h) => isActive(path, h))
      expect(matches.length, `${path} matched ${JSON.stringify(matches)}`).toBe(1)
    }
  })
})
