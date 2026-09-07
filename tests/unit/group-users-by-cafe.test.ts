import { describe, expect, it } from 'vitest'
import { groupByCafe, type UserMembershipRow } from '@/lib/group-users-by-cafe'

function row(overrides: Partial<UserMembershipRow>): UserMembershipRow {
  return {
    id: 'u1',
    full_name: 'Test User',
    email: 'test@example.com',
    phone: null,
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: null,
    last_seen_at: null,
    last_device: null,
    orders_count: 0,
    cafe_id: null,
    cafe_name: null,
    ...overrides,
  }
}

describe('groupByCafe', () => {
  it('buckets rows by cafe_id', () => {
    const rows = [
      row({ id: 'u1', cafe_id: 'cafe-a', cafe_name: 'A Café', last_seen_at: '2026-02-01T00:00:00Z' }),
      row({ id: 'u2', cafe_id: 'cafe-b', cafe_name: 'B Café', last_seen_at: '2026-02-02T00:00:00Z' }),
      row({ id: 'u3', cafe_id: 'cafe-a', cafe_name: 'A Café', last_seen_at: '2026-02-03T00:00:00Z' }),
    ]
    const groups = groupByCafe(rows)
    expect(groups.map((g) => g.cafeName)).toEqual(['A Café', 'B Café'])
    expect(groups.find((g) => g.cafeName === 'A Café')?.users.map((u) => u.id)).toEqual(['u3', 'u1'])
  })

  it('lists a multi-café user once under each of their cafés', () => {
    const rows = [
      row({ id: 'u1', cafe_id: 'cafe-a', cafe_name: 'A Café' }),
      row({ id: 'u1', cafe_id: 'cafe-b', cafe_name: 'B Café' }),
    ]
    const groups = groupByCafe(rows)
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.users[0].id === 'u1')).toBe(true)
  })

  it('sorts café groups by their most recently active member, and always puts "No café" last', () => {
    const rows = [
      row({ id: 'u1', cafe_id: null, cafe_name: null, last_seen_at: '2099-01-01T00:00:00Z' }),
      row({ id: 'u2', cafe_id: 'cafe-old', cafe_name: 'Old Café', last_seen_at: '2026-01-01T00:00:00Z' }),
      row({ id: 'u3', cafe_id: 'cafe-new', cafe_name: 'New Café', last_seen_at: '2026-06-01T00:00:00Z' }),
    ]
    const groups = groupByCafe(rows)
    expect(groups.map((g) => g.cafeName)).toEqual(['New Café', 'Old Café', 'No café'])
  })

  it('falls back through last_sign_in_at then created_at when last_seen_at is null', () => {
    const rows = [
      row({ id: 'u1', cafe_id: 'cafe-a', cafe_name: 'A', last_seen_at: null, last_sign_in_at: null, created_at: '2026-01-01T00:00:00Z' }),
      row({ id: 'u2', cafe_id: 'cafe-a', cafe_name: 'A', last_seen_at: null, last_sign_in_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }),
    ]
    const [group] = groupByCafe(rows)
    expect(group.users.map((u) => u.id)).toEqual(['u2', 'u1'])
  })
})
