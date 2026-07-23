import { describe, it, expect } from 'vitest'
import { compareTableLabels, byTableLabel } from '@/lib/table-sort'

describe('compareTableLabels', () => {
  it('reproduces the reported bug: "13" no longer jumps ahead of "T01"', () => {
    const labels = ['T05', '13', 'T01', 'T12', 'T02']
    expect([...labels].sort(compareTableLabels)).toEqual(['T01', 'T02', 'T05', 'T12', '13'])
  })

  it('sorts T01..T12 in numeric order, not lexical ("T10" before "T02")', () => {
    const labels = ['T10', 'T02', 'T01', 'T09', 'T12']
    expect([...labels].sort(compareTableLabels)).toEqual(['T01', 'T02', 'T09', 'T10', 'T12'])
  })

  it('puts purely-named tables after numbered ones', () => {
    const labels = ['Patio', 'T02', 'T01', 'Terrace']
    expect([...labels].sort(compareTableLabels)).toEqual(['T01', 'T02', 'Patio', 'Terrace'])
  })

  it('falls back to alphabetical for two purely-named tables', () => {
    expect(compareTableLabels('Terrace', 'Patio')).toBeGreaterThan(0)
    expect(compareTableLabels('Patio', 'Terrace')).toBeLessThan(0)
  })

  it('byTableLabel sorts objects with a .label field the same way', () => {
    const tables = [{ label: '13' }, { label: 'T01' }, { label: 'T05' }]
    expect(tables.sort(byTableLabel).map((t) => t.label)).toEqual(['T01', 'T05', '13'])
  })
})
