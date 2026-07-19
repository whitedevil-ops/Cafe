import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

// The demo has to survive a cafe basement, a dead hotspot, and a Supabase project the
// owner-meeting laptop was never signed into. When keys are absent the app falls back
// to local seed data rather than throwing — see lib/demo.ts.
export const supabase = isConfigured ? createClient(url!, anonKey!) : null
