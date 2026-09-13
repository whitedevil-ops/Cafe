// Regression test for the CRITICAL cafe_invites privilege-escalation bug
// found by the 2026-09-13 final production-readiness pass and fixed in
// migration 0241 — the exact same bug class as cafe_members (0239, fixed
// earlier the same day): the only INSERT policy on cafe_invites checked
// only the CALLER's own role, never the `role` value being written, so any
// manager could mint a pending 'owner' invite for an arbitrary email and
// have claim_my_invites() convert it into a real owner membership with zero
// re-validation. 0241 closes the INSERT path entirely since nothing in the
// current app creates new invites (a retired flow) — only read/delete of
// old ones remain, and this file proves those still work.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to create/tear down a throwaway
// café fixture; skips (not fails) without it, same convention as the other
// integration suites.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('cafe_invites privilege escalation is closed (live)', () => {
  let admin: SupabaseClient
  let cafeId: string
  let ownerId: string
  let managerId: string
  let ownerClient: SupabaseClient
  let managerClient: SupabaseClient

  async function makeUser(label: string) {
    const email = `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`fixture: could not create ${label} user — ${error?.message}`)
    const client = createClient(URL!, KEY!, { auth: { persistSession: false } })
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
    if (signInErr) throw new Error(`fixture: ${label} sign-in failed — ${signInErr.message}`)
    return { userId: data.user.id, client }
  }

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })

    const owner = await makeUser('civ-owner')
    ownerId = owner.userId
    ownerClient = owner.client
    const manager = await makeUser('civ-manager')
    managerId = manager.userId
    managerClient = manager.client

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes').insert({ owner_id: ownerId, slug: `test-civ-${Date.now()}`, name: 'Invite escalation test' }).select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    const { error: memErr } = await admin.from('cafe_members').insert([
      { cafe_id: cafeId, user_id: ownerId, role: 'owner', status: 'active' },
      { cafe_id: cafeId, user_id: managerId, role: 'manager', status: 'active' },
    ])
    if (memErr) throw new Error(`fixture: could not seed cafe_members — ${memErr.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    for (const id of [ownerId, managerId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('a manager cannot mint an owner invite for an arbitrary email via a direct table insert', async () => {
    const { data } = await managerClient
      .from('cafe_invites')
      .insert({ cafe_id: cafeId, email: 'attacker@khaopiyo-test.invalid', role: 'owner' })
      .select('id')
    expect(data ?? [], 'manager inserted a raw owner-role invite directly').toHaveLength(0)

    const { data: check } = await admin.from('cafe_invites').select('id').eq('cafe_id', cafeId).eq('email', 'attacker@khaopiyo-test.invalid')
    expect(check ?? [], 'the malicious invite row was actually created').toHaveLength(0)
  })

  it('a manager cannot insert even a low-privilege waiter invite anymore — the creation path is fully retired', async () => {
    const { data } = await managerClient
      .from('cafe_invites')
      .insert({ cafe_id: cafeId, email: 'new-waiter@khaopiyo-test.invalid', role: 'waiter' })
      .select('id')
    expect(data ?? [], 'a direct invite insert of any role succeeded').toHaveLength(0)
  })

  it('viewing and removing an existing (pre-seeded) invite still works for an owner/manager — the legitimate flows are unaffected', async () => {
    const { data: seeded, error: seedErr } = await admin
      .from('cafe_invites').insert({ cafe_id: cafeId, email: 'legacy-invite@khaopiyo-test.invalid', role: 'waiter' }).select('id').single()
    if (seedErr || !seeded) throw new Error(`fixture: could not seed a legacy invite — ${seedErr?.message}`)

    const { data: seen, error: readErr } = await ownerClient.from('cafe_invites').select('id, email').eq('id', seeded.id)
    expect(readErr).toBeFalsy()
    expect(seen ?? []).toHaveLength(1)

    const { error: delErr } = await managerClient.from('cafe_invites').delete().eq('id', seeded.id)
    expect(delErr).toBeFalsy()
    const { data: gone } = await admin.from('cafe_invites').select('id').eq('id', seeded.id)
    expect(gone ?? []).toHaveLength(0)
  })
})
