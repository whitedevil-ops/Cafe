export type UserMembershipRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  created_at: string
  last_sign_in_at: string | null
  last_seen_at: string | null
  last_device: string | null
  orders_count: number
  cafe_id: string | null
  cafe_name: string | null
}

export type CafeGroup = {
  cafeId: string | null
  cafeName: string
  users: UserMembershipRow[]
}

function activityTime(u: UserMembershipRow) {
  return new Date(u.last_seen_at ?? u.last_sign_in_at ?? u.created_at).getTime()
}

/**
 * Groups the flat (user, café-membership) rows the op_list_users RPC
 * returns into one entry per café — most recently active café first, the
 * "No café" bucket (cafe_id null) always last regardless of activity. A
 * user in more than one café appears once per group.
 */
export function groupByCafe(rows: UserMembershipRow[]): CafeGroup[] {
  const groups = new Map<string, CafeGroup>()
  for (const r of rows) {
    const key = r.cafe_id ?? '__none__'
    let g = groups.get(key)
    if (!g) {
      g = { cafeId: r.cafe_id, cafeName: r.cafe_name ?? 'No café', users: [] }
      groups.set(key, g)
    }
    g.users.push(r)
  }
  for (const g of groups.values()) g.users.sort((a, b) => activityTime(b) - activityTime(a))
  return Array.from(groups.values()).sort((a, b) => {
    if (a.cafeId === null) return 1
    if (b.cafeId === null) return -1
    return activityTime(b.users[0]) - activityTime(a.users[0])
  })
}
