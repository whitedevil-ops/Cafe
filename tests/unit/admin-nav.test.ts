import { describe, it, expect } from 'vitest'
import { isActive } from '@/components/platform-admin/sidebar-nav'

// The console root is /platform-admin, so "does this nav item match the
// current URL" is the one place this can go wrong: a naive startsWith marks
// Overview active on every screen, and an over-strict equals means a café
// detail page lights up nothing at all.

describe('isActive', () => {
  it('marks Overview active only at the console root', () => {
    expect(isActive('/platform-admin', '/platform-admin')).toBe(true)
    expect(isActive('/platform-admin/cafes', '/platform-admin')).toBe(false)
    expect(isActive('/platform-admin/audit-logs', '/platform-admin')).toBe(false)
  })

  it('keeps a section active on its own detail pages', () => {
    expect(isActive('/platform-admin/cafes', '/platform-admin/cafes')).toBe(true)
    expect(isActive('/platform-admin/cafes/abc-123', '/platform-admin/cafes')).toBe(true)
  })

  it('does not light up a sibling section', () => {
    expect(isActive('/platform-admin/cafes', '/platform-admin/users')).toBe(false)
    expect(isActive('/platform-admin/health', '/platform-admin/audit-logs')).toBe(false)
  })

  it('leaves exactly one item active on every real console path', () => {
    const hrefs = [
      '/platform-admin',
      '/platform-admin/cafes',
      '/platform-admin/users',
      '/platform-admin/leads',
      '/platform-admin/health',
      '/platform-admin/audit-logs',
      '/platform-admin/admins',
    ]
    const paths = [...hrefs, '/platform-admin/cafes/abc-123']

    for (const path of paths) {
      const matches = hrefs.filter((h) => isActive(path, h))
      expect(matches.length, `${path} matched ${JSON.stringify(matches)}`).toBe(1)
    }
  })
})
