// Vitest doesn't auto-load .env.local the way Next.js does. Integration tests
// need NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to hit the
// real, live project — the same two values Next.js reads at runtime.
import { readFileSync, existsSync } from 'fs'
import path from 'path'

export default function setup() {
  const envPath = path.resolve(__dirname, '..', '.env.local')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}
