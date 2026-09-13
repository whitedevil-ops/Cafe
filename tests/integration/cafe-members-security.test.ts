// Regression test for the CRITICAL cafe_members privilege-escalation bug
// found by the 2026-09-13 production maturity audit and fixed in migration
// 0239: cafe_members' only INSERT/UPDATE/DELETE policies (0001) checked only
// the CALLER's own role at a café, never the row being targeted — so any
// manager could self-promote to owner, or suspend/demote the real owner, via
// a direct table write, bypassing the app and the properly-guarded
// create_staff_member RPC entirely.
//
// 0239 revokes direct insert/update/delete on cafe_members from
// authenticated/anon and adds remove_staff_member() (owner-only, refuses to
// remove the last active owner) as the one remaining legitimate delete path.
// This file proves, with real authenticated sessions (not just anon), that
// the escalation is closed and the legitimate flows still work.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to build the fixture; skips (not
// fails) without it, same convention as two-tenant-isolation.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('cafe_members privilege escalation is closed (live)', () => {
  let admin: SupabaseClient
  let cafeAId: string
  let cafeBId: string
  let ownerAId: string
  let managerAId: string
  let waiterAId: string
  let ownerBId: string
  let ownerAClient: SupabaseClient
  let managerAClient: SupabaseClient
  let ownerBClient: SupabaseClient

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

    const owner = await makeUser('cma-owner')
    ownerAId = owner.userId
    ownerAClient = owner.client
    const manager = await makeUser('cma-manager')
    managerAId = manager.userId
    managerAClient = manager.client
    const waiter = await makeUser('cma-waiter')
    waiterAId = waiter.userId
    const ownerB = await makeUser('cma-ownerb')
    ownerBId = ownerB.userId
    ownerBClient = ownerB.client

    const { data: a, error: aErr } = await admin
      // plan: 'business' — the default (trial) plan's 1-staff seat cap would
      // reject create_staff_member's legitimate re-add of the waiter below,
      // for a reason unrelated to what this file actually tests.
      .from('cafes').insert({ owner_id: ownerAId, slug: `test-cma-a-${Date.now()}`, name: 'Escalation test A', plan: 'business' }).select('id').single()
    if (aErr || !a) throw new Error(`fixture: could not create café A — ${aErr?.message}`)
    cafeAId = a.id as string

    const { data: b, error: bErr } = await admin
      .from('cafes').insert({ owner_id: ownerBId, slug: `test-cma-b-${Date.now()}`, name: 'Escalation test B' }).select('id').single()
    if (bErr || !b) throw new Error(`fixture: could not create café B — ${bErr?.message}`)
    cafeBId = b.id as string

    const { error: memErr } = await admin.from('cafe_members').insert([
      { cafe_id: cafeAId, user_id: ownerAId, role: 'owner', status: 'active' },
      { cafe_id: cafeAId, user_id: managerAId, role: 'manager', status: 'active' },
      { cafe_id: cafeAId, user_id: waiterAId, role: 'waiter', status: 'active' },
      { cafe_id: cafeBId, user_id: ownerBId, role: 'owner', status: 'active' },
    ])
    if (memErr) throw new Error(`fixture: could not seed cafe_members — ${memErr.message}`)
  })

  afterAll(async () => {
    if (cafeAId) await admin.from('cafes').delete().eq('id', cafeAId)
    if (cafeBId) await admin.from('cafes').delete().eq('id', cafeBId)
    for (const id of [ownerAId, managerAId, waiterAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('a manager cannot self-promote to owner via a direct table UPDATE', async () => {
    const { data, error } = await managerAClient
      .from('cafe_members')
      .update({ role: 'owner' })
      .eq('cafe_id', cafeAId)
      .eq('user_id', managerAId)
      .select('role')
    expect(data ?? [], 'manager self-promoted to owner').toHaveLength(0)
    void error
    const { data: check } = await admin.from('cafe_members').select('role').eq('cafe_id', cafeAId).eq('user_id', managerAId).single()
    expect(check?.role).toBe('manager')
  })

  it('a manager cannot suspend/demote the real owner via a direct table UPDATE', async () => {
    const { data } = await managerAClient
      .from('cafe_members')
      .update({ status: 'suspended' })
      .eq('cafe_id', cafeAId)
      .eq('user_id', ownerAId)
      .select('status')
    expect(data ?? [], 'manager suspended the real owner').toHaveLength(0)
    const { data: check } = await admin.from('cafe_members').select('status').eq('cafe_id', cafeAId).eq('user_id', ownerAId).single()
    expect(check?.status).toBe('active')
  })

  it('a manager cannot insert an arbitrary membership row directly, bypassing create_staff_member', async () => {
    const { data } = await managerAClient
      .from('cafe_members')
      .insert({ cafe_id: cafeAId, user_id: crypto.randomUUID(), role: 'owner', status: 'active' })
      .select('user_id')
    expect(data ?? [], 'manager inserted a raw membership row directly').toHaveLength(0)
  })

  it('a manager cannot call remove_staff_member — owner-only', async () => {
    const { error } = await managerAClient.rpc('remove_staff_member', { p_cafe_id: cafeAId, p_user_id: waiterAId })
    expect(error?.message ?? '', 'expected an owner-only rejection').toMatch(/only an owner/i)
    const { data: check } = await admin.from('cafe_members').select('user_id').eq('cafe_id', cafeAId).eq('user_id', waiterAId).maybeSingle()
    expect(check, 'waiter was removed by a non-owner').not.toBeNull()
  })

  it("café B's owner cannot remove a café A member — cross-café manipulation fails", async () => {
    const { error } = await ownerBClient.rpc('remove_staff_member', { p_cafe_id: cafeAId, p_user_id: waiterAId })
    expect(error?.message ?? '', 'expected an owner-only rejection for the wrong café').toMatch(/only an owner/i)
    const { data: check } = await admin.from('cafe_members').select('user_id').eq('cafe_id', cafeAId).eq('user_id', waiterAId).maybeSingle()
    expect(check, 'café A member was removed by café B\'s owner').not.toBeNull()
  })

  it('the real owner CAN remove a non-owner staff member — authorized operation still works', async () => {
    const { error } = await ownerAClient.rpc('remove_staff_member', { p_cafe_id: cafeAId, p_user_id: waiterAId })
    expect(error).toBeFalsy()
    const { data: check } = await admin.from('cafe_members').select('user_id').eq('cafe_id', cafeAId).eq('user_id', waiterAId).maybeSingle()
    expect(check, 'owner-authorized removal did not take effect').toBeNull()
  })

  it('the owner cannot remove the only remaining owner of their own café', async () => {
    const { error } = await ownerAClient.rpc('remove_staff_member', { p_cafe_id: cafeAId, p_user_id: ownerAId })
    expect(error?.message ?? '', 'expected a last-owner rejection').toMatch(/only owner|only active owner|cannot remove the only owner/i)
    const { data: check } = await admin.from('cafe_members').select('user_id').eq('cafe_id', cafeAId).eq('user_id', ownerAId).maybeSingle()
    expect(check, 'sole owner was removed').not.toBeNull()
  })

  it('create_staff_member (the legitimate add-staff RPC) is unaffected and still works for an owner', async () => {
    const { data, error } = await ownerAClient.rpc('create_staff_member', {
      p_cafe_id: cafeAId,
      p_user_id: waiterAId,
      p_role: 'waiter',
    })
    expect(error).toBeFalsy()
    expect((data as { role: string } | null)?.role).toBe('waiter')
    const { data: check } = await admin.from('cafe_members').select('role,status').eq('cafe_id', cafeAId).eq('user_id', waiterAId).single()
    expect(check?.role).toBe('waiter')
    expect(check?.status).toBe('active')
  })
})
