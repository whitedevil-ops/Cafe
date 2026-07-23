'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Receipt, RotateCcw, ShieldCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDate, formatTime, isToday } from '@/lib/datetime'

type HistoryItem = { name: string; qty: number; price: number; modifiers: { name: string }[] | null }
type HistoryOrder = {
  id: string
  short_code: string
  status: string
  payment_status: string
  payment_method: string | null
  subtotal: number
  discount: number
  tax: number
  service_charge: number
  total: number
  created_at: string
  receipt_token: string
  type: string
  table_label: string | null
  items: HistoryItem[]
}
type History = { total: number; limit: number; offset: number; cafe_name: string; orders: HistoryOrder[] }

const PAGE_SIZE = 10
const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'served']
const STATUS_LABEL: Record<string, string> = {
  placed: 'Order placed', accepted: 'Accepted', preparing: 'Preparing',
  ready: 'Ready', served: 'Served', completed: 'Completed',
}

// Only a convenience cache of the server-issued token. The database decides
// whether it is still valid — a stale or forged value simply fails server-side.
const sessionKey = (token: string) => `kp_customer_session_${token}`

export default function MyOrdersClient({
  token,
  cafeName,
  tableLabel,
  timezone,
}: {
  token: string
  cafeName: string
  tableLabel: string
  timezone: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [checkedStorage, setCheckedStorage] = useState(false)
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [history, setHistory] = useState<History | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [reordering, setReordering] = useState<string | null>(null)

  useEffect(() => {
    setSessionToken(localStorage.getItem(sessionKey(token)))
    setCheckedStorage(true)
  }, [token])

  const loadHistory = useCallback(
    async (st: string, pageIndex: number) => {
      setLoading(true)
      const { data, error: rpcError } = await supabase.rpc('customer_order_history', {
        p_session_token: st,
        p_limit: PAGE_SIZE,
        p_offset: pageIndex * PAGE_SIZE,
      })
      setLoading(false)
      if (rpcError) {
        // Expired/revoked session — drop it and fall back to verification.
        localStorage.removeItem(sessionKey(token))
        setSessionToken(null)
        setError(rpcError.message)
        return
      }
      setHistory(data as History)
    },
    [supabase, token],
  )

  useEffect(() => {
    if (sessionToken) void loadHistory(sessionToken, page)
  }, [sessionToken, page, loadHistory])

  // Live status for anything still in the kitchen.
  const hasActive = (history?.orders ?? []).some((o) => ACTIVE.includes(o.status))
  useEffect(() => {
    if (!sessionToken || !hasActive) return
    const id = setInterval(() => void loadHistory(sessionToken, page), 10000)
    return () => clearInterval(id)
  }, [sessionToken, hasActive, page, loadHistory])

  async function requestCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/customer/request-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table_token: token, phone }),
    })
    setBusy(false)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return setError(body.error ?? 'Could not send a code right now.')
    setStep('code')
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('customer_verify_otp', {
      p_table_token: token,
      p_phone: phone,
      p_code: code,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    const st = (data as { session_token: string }).session_token
    localStorage.setItem(sessionKey(token), st)
    setSessionToken(st)
    setStep('phone')
    setCode('')
  }

  async function reorder(orderId: string) {
    if (!sessionToken) return
    setReordering(orderId)
    const { data, error: rpcError } = await supabase.rpc('customer_reorder_payload', {
      p_session_token: sessionToken,
      p_order_id: orderId,
    })
    setReordering(null)
    if (rpcError) return setError(rpcError.message)
    const payload = data as { items: unknown[]; unavailable: string[] }
    // Handed to the menu screen, which puts it through the normal cart and the
    // existing place_order — reorder never becomes a second write path.
    sessionStorage.setItem(`kp_reorder_${token}`, JSON.stringify(payload))
    router.push(`/t/${token}`)
  }

  function signOut() {
    localStorage.removeItem(sessionKey(token))
    setSessionToken(null)
    setHistory(null)
    setPhone('')
  }

  const header = (
    <header className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-3">
      <div className="flex items-center gap-3">
        <Link href={`/t/${token}`} aria-label="Back to menu" className="grid h-9 w-9 shrink-0 place-items-center text-muted-foreground">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-foreground">My orders</h1>
          <p className="truncate text-[12px] text-muted-foreground">{cafeName} · Table {tableLabel}</p>
        </div>
        {sessionToken && (
          <button onClick={signOut} className="shrink-0 text-[12.5px] text-muted-foreground hover:text-foreground">
            Sign out
          </button>
        )}
      </div>
    </header>
  )

  if (!checkedStorage) return <div className="min-h-dvh bg-background">{header}</div>

  // ── Verification gate ────────────────────────────────────────────────────
  if (!sessionToken) {
    return (
      <div className="min-h-dvh bg-background">
        {header}
        <main className="mx-auto w-full max-w-sm px-5 py-10">
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-subtle text-primary">
              <ShieldCheck size={20} />
            </span>
            <h2 className="mt-3 text-[17px] font-semibold text-foreground">
              {step === 'phone' ? 'Verify your number' : 'Enter the code'}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {step === 'phone'
                ? 'Your order history is private. We’ll text a one-time code to confirm it’s you.'
                : `We sent a 6-digit code to ${phone}. It expires in 10 minutes.`}
            </p>

            {step === 'phone' ? (
              <form onSubmit={requestCode} className="mt-5 space-y-3">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  inputMode="numeric"
                  autoComplete="tel"
                  className="h-12 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[15px] text-foreground placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={busy || phone.length !== 10}
                  className="min-h-12 w-full rounded-[var(--radius)] bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {busy ? 'Sending…' : 'Send code'}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyCode} className="mt-5 space-y-3">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  className="h-12 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-center text-[20px] tracking-[0.3em] text-foreground placeholder:text-[15px] placeholder:tracking-normal placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="min-h-12 w-full rounded-[var(--radius)] bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {busy ? 'Verifying…' : 'View my orders'}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setCode(''); setError(null) }}
                  className="w-full text-[13px] text-muted-foreground hover:text-foreground"
                >
                  Use a different number
                </button>
              </form>
            )}

            {error && (
              <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
            )}
          </div>
        </main>
      </div>
    )
  }

  // ── History ──────────────────────────────────────────────────────────────
  const orders = history?.orders ?? []
  const active = orders.filter((o) => ACTIVE.includes(o.status))
  const past = orders.filter((o) => !ACTIVE.includes(o.status))
  const totalPages = history ? Math.ceil(history.total / PAGE_SIZE) : 0

  return (
    <div className="min-h-dvh bg-background">
      {header}
      <main className="mx-auto w-full max-w-lg px-5 py-6">
        {loading && !history && <p className="py-16 text-center text-sm text-muted-foreground">Loading your orders…</p>}

        {history && orders.length === 0 && (
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-8 text-center">
            <h2 className="text-[16px] font-semibold text-foreground">No orders yet</h2>
            <p className="mx-auto mt-1 max-w-xs text-[13.5px] leading-relaxed text-muted-foreground">
              Once you place your first order at {cafeName}, it’ll show up here — with your bill and a one-tap reorder.
            </p>
            <Link
              href={`/t/${token}`}
              className="mt-5 inline-block min-h-11 rounded-[var(--radius)] bg-primary px-5 py-3 text-[14px] font-semibold text-primary-foreground"
            >
              Browse the menu
            </Link>
          </div>
        )}

        {active.length > 0 && (
          <section>
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Active</h2>
            <div className="mt-2 space-y-3">
              {active.map((o) => <OrderCard key={o.id} order={o} token={token} onReorder={reorder} reordering={reordering} timezone={timezone} live />)}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section className={active.length > 0 ? 'mt-7' : ''}>
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Past orders</h2>
            <div className="mt-2 space-y-3">
              {past.map((o) => <OrderCard key={o.id} order={o} token={token} onReorder={reorder} reordering={reordering} timezone={timezone} />)}
            </div>
          </section>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="min-h-10 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-medium text-foreground disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-[12.5px] text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page + 1 >= totalPages || loading}
              className="min-h-10 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-medium text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
        )}
      </main>
    </div>
  )
}

function OrderCard({
  order,
  token,
  onReorder,
  reordering,
  live,
  timezone,
}: {
  order: HistoryOrder
  token: string
  onReorder: (id: string) => void
  reordering: string | null
  live?: boolean
  timezone: string
}) {
  // toDateString() compares in the DEVICE's zone — a customer travelling, or a
  // phone set to the wrong region, would see "yesterday's" order labelled today.
  const showTime = isToday(order.created_at, timezone)

  return (
    <article className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14.5px] font-semibold text-foreground">#{order.short_code}</span>
        <span className="text-[12px] text-muted-foreground">
          {showTime ? formatTime(order.created_at, timezone) : formatDate(order.created_at, timezone)}
        </span>
      </div>

      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {order.type === 'takeaway' ? 'Takeaway' : order.table_label ? `Table ${order.table_label}` : 'Dine-in'}
      </p>

      <ul className="mt-2.5 space-y-1">
        {order.items.map((it, i) => (
          <li key={i} className="flex justify-between gap-3 text-[13.5px]">
            <span className="min-w-0 text-foreground">
              {it.qty} × {it.name}
              {it.modifiers && it.modifiers.length > 0 && (
                <span className="block text-[11.5px] text-muted-foreground">
                  {it.modifiers.map((m) => m.name).join(', ')}
                </span>
              )}
            </span>
            <span className="shrink-0 text-muted-foreground">₹{it.price * it.qty}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="text-[15px] font-semibold text-foreground">₹{order.total}</span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
            live ? 'bg-warning-subtle text-warning' : 'bg-success-subtle text-success'
          }`}
        >
          {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />}
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <a
          href={`/r/${order.receipt_token}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-border-strong text-[13px] font-medium text-foreground"
        >
          <Receipt size={14} /> View bill
        </a>
        {!live && (
          <button
            onClick={() => onReorder(order.id)}
            disabled={reordering === order.id}
            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground disabled:opacity-40"
          >
            <RotateCcw size={14} /> {reordering === order.id ? 'Adding…' : 'Reorder'}
          </button>
        )}
      </div>

      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {order.payment_status === 'paid' ? 'Paid' : 'Pay at the counter'}
      </p>
    </article>
  )
}
