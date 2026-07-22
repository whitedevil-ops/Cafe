import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY service-role client. This key bypasses RLS entirely, so:
//   * never import this from a client component or anything under app/ that
//     ships to the browser,
//   * never pass its results straight through to a response without filtering.
// It exists for the narrow set of operations that must run with more authority
// than the caller has — currently only issuing customer OTP codes, where the
// plaintext code must be generated out of reach of the anon role.
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
