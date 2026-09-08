import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY service-role client. This key bypasses RLS entirely, so:
//   * never import this from a client component or anything under app/ that
//     ships to the browser,
//   * never pass its results straight through to a response without filtering.
// It exists for the narrow set of operations that must run with more authority
// than the caller has — issuing customer OTP codes, creating a new Ops
// admin's auth account, and directly setting an admin's or café member's
// password/email, all via Supabase Auth's admin API (auth.admin.*), which
// only works with this key.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function adminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL)
}
