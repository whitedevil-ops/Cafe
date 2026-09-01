'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  readCustomerSession,
  writeCustomerSession,
  clearCustomerSession,
  getOrCreateDeviceId,
  type CustomerSession,
} from '@/lib/customer-session'

const PHONE_RE = /^[6-9]\d{9}$/

// Shared login gate for the QR customer flow (menu + My Orders).
//
// No OTP right now — SMS/DLT was never set up, and shipping OTP as a hard
// requirement without it live took customer ordering down entirely
// (migration 0088 → 0089 reverted this same day). customer_start_session
// still does real device-trust bookkeeping server-side (customer_devices,
// one active device per customer per café) — it just isn't proven by a
// code yet. Swapping back to customer_verify_otp later, once SMS is
// actually configured, is a one-line change here.
//
// Two phases:
//  1. checking — silently re-validate a cached session against the server
//     (customer_session_status) so a device revoked elsewhere is caught
//     immediately, not just on the next protected call.
//  2. phone    — name + phone, shown whenever no still-valid session exists.
export function CustomerLoginGate({
  token,
  cafeId,
  cafeName,
  cafeLogo,
  tableLabel,
  onReady,
}: {
  token: string
  cafeId: string
  cafeName: string
  cafeLogo?: string | null
  tableLabel?: string
  onReady: (session: CustomerSession) => void
}) {
  const supabaseRef = useRef(createClient())
  const [phase, setPhase] = useState<'checking' | 'phone' | 'welcome'>('checking')
  const [welcomeName, setWelcomeName] = useState('')

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const cached = readCustomerSession(cafeId)
      if (!cached) {
        if (!cancelled) setPhase('phone')
        return
      }
      const supabase = supabaseRef.current
      // Bounded: an unresponsive session check must not strand the customer
      // on a blank screen forever — fall back to the phone form instead.
      const { data, error: rpcError } = await supabase
        .rpc('customer_session_status', { p_session_token: cached.token })
        .abortSignal(AbortSignal.timeout(5000))
      if (cancelled) return
      const valid = !rpcError && (data as { valid?: boolean } | null)?.valid === true
      if (valid) {
        setWelcomeName(cached.name)
        setPhase('welcome')
        setTimeout(() => { if (!cancelled) onReady(cached) }, 300)
      } else {
        clearCustomerSession(cafeId)
        setPhase('phone')
      }
    }
    void check()
    return () => { cancelled = true }
    // onReady intentionally excluded — it's a stable callback from the
    // parent's perspective for the lifetime of this gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cafeId])

  async function startSession(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = supabaseRef.current
    const { data, error: rpcError } = await supabase.rpc('customer_start_session', {
      p_table_token: token,
      p_phone: phone,
      p_name: name,
      p_device_id: getOrCreateDeviceId(),
      p_ref_code: null,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    const st = (data as { session_token: string }).session_token
    const session = { token: st, name: name.trim(), phone }
    writeCustomerSession(cafeId, session)
    onReady(session)
  }

  if (phase === 'checking') {
    return (
      <main className="mx-auto flex w-full min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-6">
        <div className="h-12 w-12 animate-pulse rounded-full bg-surface-subtle" />
        <div className="h-3 w-32 animate-pulse rounded-full bg-surface-subtle" />
      </main>
    )
  }

  if (phase === 'welcome') {
    return (
      <main className="mx-auto flex w-full min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-success-subtle text-2xl text-success">✓</div>
        <p className="text-[17px] font-semibold text-foreground">Welcome back{welcomeName ? `, ${welcomeName}` : ''}</p>
        {tableLabel && <p className="text-[13px] text-muted-foreground">Ordering from Table {tableLabel}</p>}
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6">
        {cafeLogo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cafeLogo} alt="" className="mb-3 h-12 w-12 rounded-xl object-cover" />
        )}
        <p className="text-[12px] font-semibold uppercase tracking-wide text-primary">Login</p>
        <h1 className="mt-0.5 text-[18px] font-semibold text-foreground">{cafeName}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {tableLabel ? `Table ${tableLabel} — l` : 'L'}ogin with your name and mobile number to continue. This is required.
        </p>
        <form onSubmit={startSession} className="mt-5 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            autoFocus
            // 16px, not 15 — this field autofocuses on load, so it's the
            // very first thing WebKit's zoom-under-16px rule can fire on.
            className="h-12 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex items-center rounded-[var(--radius)] border border-border-strong bg-surface">
            <span className="pl-4 pr-2 text-muted-foreground">+91</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="98765 43210"
              inputMode="numeric"
              autoComplete="tel"
              className="h-12 w-full rounded-r-[var(--radius)] bg-transparent pr-4 text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || name.trim().length === 0 || !PHONE_RE.test(phone)}
            className="min-h-12 w-full rounded-[var(--radius)] bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            {busy ? 'Logging in…' : 'Login'}
          </button>
          {error && (
            <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
          )}
        </form>
      </div>
    </main>
  )
}
