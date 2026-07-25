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
const RESEND_COOLDOWN_S = 30

// Shared login gate for the QR customer flow (menu + My Orders). Renders
// nothing meaningful of its own once a session is established — it calls
// onReady and the parent takes over. Three phases:
//  1. checking  — silently re-validate a cached session against the server
//     (customer_session_status) so a device revoked elsewhere is caught
//     immediately, not just on the next protected call.
//  2. phone/otp — name + phone, then a real SMS code (customer_verify_otp),
//     which also registers/revokes trusted devices server-side — see
//     migration 0088. There is no phone-only path any more.
//  3. welcome   — brief, auto-continuing recognition flash for a device
//     that was already trusted, so returning customers never re-type
//     anything (this is NOT a login step, just an acknowledgement).
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
  const [phase, setPhase] = useState<'checking' | 'phone' | 'otp' | 'welcome'>('checking')
  const [welcomeName, setWelcomeName] = useState('')

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const cached = readCustomerSession(cafeId)
      if (!cached) {
        if (!cancelled) setPhase('phone')
        return
      }
      const supabase = supabaseRef.current
      const { data, error: rpcError } = await supabase.rpc('customer_session_status', {
        p_session_token: cached.token,
      })
      if (cancelled) return
      const valid = !rpcError && (data as { valid?: boolean } | null)?.valid === true
      if (valid) {
        setWelcomeName(cached.name)
        setPhase('welcome')
        setTimeout(() => { if (!cancelled) onReady(cached) }, 1100)
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

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/customer/request-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table_token: token, phone }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(body.error ?? 'Could not send the code. Please try again.')
    setCode('')
    setCooldown(RESEND_COOLDOWN_S)
    setPhase('otp')
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = supabaseRef.current
    const { data, error: rpcError } = await supabase.rpc('customer_verify_otp', {
      p_table_token: token,
      p_phone: phone,
      p_code: code,
      p_device_id: getOrCreateDeviceId(),
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    const st = (data as { session_token: string }).session_token
    const session = { token: st, name: name.trim(), phone }
    writeCustomerSession(cafeId, session)
    onReady(session)
  }

  if (phase === 'checking') {
    return <main className="min-h-dvh bg-background" />
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

        {phase === 'phone' ? (
          <>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {tableLabel ? `Table ${tableLabel} — l` : 'L'}ogin with your name and mobile number to continue. This is required.
            </p>
            <form onSubmit={sendCode} className="mt-5 space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                autoFocus
                className="h-12 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[15px] text-foreground placeholder:text-muted-foreground"
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
                {busy ? 'Sending code…' : 'Send code'}
              </button>
              {error && (
                <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
              )}
            </form>
          </>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Enter the 6-digit code sent to +91 {phone}.
            </p>
            <form onSubmit={verifyCode} className="mt-5 space-y-3">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className="h-12 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-center text-[20px] tracking-[0.3em] text-foreground placeholder:text-muted-foreground placeholder:tracking-normal"
              />
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="min-h-12 w-full rounded-[var(--radius)] bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
              >
                {busy ? 'Verifying…' : 'Verify & continue'}
              </button>
              {error && (
                <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
              )}
              <div className="flex items-center justify-between text-[12.5px]">
                <button
                  type="button"
                  onClick={() => { setPhase('phone'); setError(null) }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Change number
                </button>
                <button
                  type="button"
                  onClick={(e) => sendCode(e as unknown as React.FormEvent)}
                  disabled={cooldown > 0 || busy}
                  className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
