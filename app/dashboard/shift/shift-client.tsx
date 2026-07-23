'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Wallet, ArrowDownCircle, ArrowUpCircle, Lock, Unlock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/datetime'

export type ShiftSummary = {
  shift_id: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  opening_cash: number
  cash_sales: number
  cash_refunds: number
  cash_added: number
  cash_removed: number
  expected_cash: number
  counted_cash: number | null
  difference: number | null
  notes: string | null
}

export type ShiftHistoryRow = {
  id: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  opening_cash: number
  expected_cash: number | null
  counted_cash: number | null
  difference: number | null
  notes: string | null
  opened_by_name: string | null
  closed_by_name: string | null
}

const MOVEMENT_KINDS = [
  { key: 'add', label: 'Cash added', icon: ArrowDownCircle, hint: 'Float top-up, change brought in' },
  { key: 'remove', label: 'Cash removed', icon: ArrowUpCircle, hint: 'Banked, moved to safe' },
  { key: 'petty', label: 'Petty cash', icon: Wallet, hint: 'Small purchase from the drawer' },
] as const

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function ShiftClient({
  cafeId,
  timezone,
  role,
  initialShift,
  initialHistory,
}: {
  cafeId: string
  timezone: string
  role: string
  initialShift: ShiftSummary | null
  initialHistory: ShiftHistoryRow[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [shift, setShift] = useState(initialShift)
  const [history, setHistory] = useState(initialHistory)
  const [openingCash, setOpeningCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [moveKind, setMoveKind] = useState<'add' | 'remove' | 'petty'>('add')
  const [moveAmount, setMoveAmount] = useState('')
  const [moveReason, setMoveReason] = useState('')

  const [counted, setCounted] = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [closing, setClosing] = useState(false)

  const canManage = ['owner', 'manager', 'cashier'].includes(role)

  const refresh = useCallback(async () => {
    const [{ data: cur }, { data: hist }] = await Promise.all([
      supabase.rpc('current_shift', { p_cafe_id: cafeId }),
      supabase.rpc('recent_shifts', { p_cafe_id: cafeId, p_limit: 15 }),
    ])
    setShift((cur ?? null) as ShiftSummary | null)
    setHistory((hist ?? []) as ShiftHistoryRow[])
  }, [supabase, cafeId])

  // Cash sales move as orders are paid elsewhere in the app, so an open shift's
  // expected figure would otherwise go stale while someone watches it.
  useEffect(() => {
    if (!shift || shift.status !== 'open') return
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [shift, refresh])

  async function openShift() {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('open_shift', {
      p_cafe_id: cafeId,
      p_opening_cash: Number(openingCash) || 0,
    })
    setBusy(false)
    if (err) return setError(err.message)
    setOpeningCash('')
    toast('Shift opened.')
    void refresh()
  }

  async function addMovement() {
    if (!shift || !moveAmount || !moveReason.trim()) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('record_cash_movement', {
      p_shift_id: shift.shift_id,
      p_kind: moveKind,
      p_amount: Number(moveAmount),
      p_reason: moveReason.trim(),
    })
    setBusy(false)
    if (err) return setError(err.message)
    setMoveAmount('')
    setMoveReason('')
    toast('Cash movement recorded.')
    void refresh()
  }

  async function doClose() {
    if (!shift) return
    const countedNum = Number(counted)
    const diff = countedNum - shift.expected_cash
    const ok = await confirm({
      title: 'Close this shift?',
      description:
        diff === 0
          ? `Counted ${rupees(countedNum)}, exactly matching expected. This cannot be reopened.`
          : `Counted ${rupees(countedNum)} against expected ${rupees(shift.expected_cash)} — a ${
              diff < 0 ? 'shortage' : 'excess'
            } of ${rupees(Math.abs(diff))}. This is recorded permanently and cannot be reopened.`,
      confirmLabel: 'Close shift',
      destructive: diff !== 0,
    })
    if (!ok) return

    setClosing(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('close_shift', {
      p_shift_id: shift.shift_id,
      p_counted_cash: countedNum,
      p_notes: closeNotes.trim() || null,
    })
    setClosing(false)
    if (err) return setError(err.message)
    const s = data as ShiftSummary
    toast(
      s.difference === 0
        ? 'Shift closed — drawer balanced exactly.'
        : `Shift closed — ${s.difference! < 0 ? 'short' : 'excess'} ${rupees(Math.abs(s.difference!))}.`,
      s.difference === 0 ? 'success' : 'error',
    )
    setCounted('')
    setCloseNotes('')
    void refresh()
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Shift &amp; cash register</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open with a float, track what moves in and out, close by counting the drawer.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-4 py-3 text-[13px] text-destructive">{error}</p>
      )}

      {/* ── No open shift ────────────────────────────────────────────────── */}
      {!shift && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-6">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Unlock size={17} /> No shift open
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Count the cash already in the drawer and enter it as the opening float.
          </p>
          {canManage ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Opening cash, e.g. 5000"
                inputMode="numeric"
                className="h-11 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
              <Button onClick={openShift} loading={busy}>Open shift</Button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">Your role cannot open a shift.</p>
          )}
        </section>
      )}

      {/* ── Open shift ───────────────────────────────────────────────────── */}
      {shift && shift.status === 'open' && (
        <>
          <section className="mt-6 rounded-xl border border-border bg-surface p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                <Wallet size={17} /> Drawer
              </h2>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                Open since {formatDateTime(shift.opened_at, timezone)}
              </span>
            </div>

            <dl className="mt-4 space-y-2 text-[14px]">
              <Row label="Opening cash" value={rupees(shift.opening_cash)} />
              <Row label="Cash sales" value={`+ ${rupees(shift.cash_sales)}`} tone="positive" />
              {shift.cash_refunds > 0 && <Row label="Cash refunds" value={`− ${rupees(shift.cash_refunds)}`} tone="negative" />}
              {shift.cash_added > 0 && <Row label="Cash added" value={`+ ${rupees(shift.cash_added)}`} tone="positive" />}
              {shift.cash_removed > 0 && <Row label="Cash removed / petty" value={`− ${rupees(shift.cash_removed)}`} tone="negative" />}
              <div className="flex items-baseline justify-between border-t border-border-strong pt-3">
                <dt className="text-[15px] font-medium text-foreground">Expected in drawer</dt>
                <dd className="text-[22px] font-semibold text-foreground">{rupees(shift.expected_cash)}</dd>
              </div>
            </dl>
          </section>

          {canManage && (
            <section className="mt-5 rounded-xl border border-border bg-surface p-6">
              <h2 className="text-base font-medium text-foreground">Move cash</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {MOVEMENT_KINDS.map((k) => {
                  const Icon = k.icon
                  return (
                    <button
                      key={k.key}
                      onClick={() => setMoveKind(k.key)}
                      className={`flex flex-col items-start gap-1 rounded-[var(--radius)] border p-3 text-left transition-colors ${
                        moveKind === k.key ? 'border-primary bg-primary-subtle' : 'border-border-strong'
                      }`}
                    >
                      <Icon size={16} className={moveKind === k.key ? 'text-primary' : 'text-muted-foreground'} />
                      <span className={`text-[13px] font-medium ${moveKind === k.key ? 'text-primary' : 'text-foreground'}`}>
                        {k.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{k.hint}</span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Amount"
                  inputMode="numeric"
                  className="h-11 w-32 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <input
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder="Reason — required"
                  className="h-11 min-w-[180px] flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <Button onClick={addMovement} loading={busy} disabled={!moveAmount || !moveReason.trim()}>
                  Record
                </Button>
              </div>
            </section>
          )}

          {canManage && (
            <section className="mt-5 rounded-xl border border-border bg-surface p-6">
              <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                <Lock size={17} /> Close shift
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Count the drawer and enter the actual amount. Any difference is recorded permanently.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={counted}
                  onChange={(e) => setCounted(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Counted cash"
                  inputMode="numeric"
                  className="h-11 w-40 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <input
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="h-11 min-w-[180px] flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {counted !== '' && (
                <PreviewDifference expected={shift.expected_cash} counted={Number(counted)} />
              )}

              <Button
                onClick={doClose}
                loading={closing}
                disabled={counted === ''}
                className="mt-3"
              >
                Close shift
              </Button>
            </section>
          )}
        </>
      )}

      {/* ── History ──────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Recent shifts</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted-foreground">No shifts recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((s) => (
              <li key={s.id} className="rounded-[var(--radius)] border border-border bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-medium text-foreground">
                    {formatDateTime(s.opened_at, timezone)}
                    {s.closed_at && ` → ${formatDateTime(s.closed_at, timezone)}`}
                  </span>
                  {s.status === 'open' ? (
                    <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[11.5px] font-medium text-success">Open</span>
                  ) : s.difference === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11.5px] font-medium text-success">
                      <CheckCircle2 size={12} /> Balanced
                    </span>
                  ) : (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                      (s.difference ?? 0) < 0 ? 'bg-destructive-subtle text-destructive' : 'bg-warning-subtle text-warning'
                    }`}>
                      <AlertTriangle size={12} />
                      {(s.difference ?? 0) < 0 ? 'Short' : 'Excess'} {rupees(Math.abs(s.difference ?? 0))}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Opened by {s.opened_by_name ?? '—'}
                  {s.closed_by_name && ` · closed by ${s.closed_by_name}`}
                  {s.status === 'closed' && ` · expected ${rupees(s.expected_cash ?? 0)}, counted ${rupees(s.counted_cash ?? 0)}`}
                </p>
                {s.notes && <p className="mt-1 text-[12px] italic text-muted-foreground">“{s.notes}”</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={tone === 'negative' ? 'text-destructive' : tone === 'positive' ? 'text-foreground' : 'text-foreground'}>
        {value}
      </dd>
    </div>
  )
}

function PreviewDifference({ expected, counted }: { expected: number; counted: number }) {
  const diff = counted - expected
  if (diff === 0) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-success-subtle px-3 py-2 text-[13px] font-medium text-success">
        <CheckCircle2 size={14} /> Balances exactly.
      </p>
    )
  }
  return (
    <p
      className={`mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius)] px-3 py-2 text-[13px] font-medium ${
        diff < 0 ? 'bg-destructive-subtle text-destructive' : 'bg-warning-subtle text-warning'
      }`}
    >
      <AlertTriangle size={14} />
      {diff < 0 ? 'Short' : 'Excess'} {rupees(Math.abs(diff))} against expected {rupees(expected)}
    </p>
  )
}
