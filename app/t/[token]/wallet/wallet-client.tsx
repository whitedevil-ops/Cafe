'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, PiggyBank } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { loadRazorpayCheckout } from '@/lib/razorpay-client'
import { formatDayMonth } from '@/lib/datetime'
import { clearCustomerSession, type CustomerSession } from '@/lib/customer-session'
import { CustomerFooterNav } from '@/components/qr/customer-footer-nav'
import { CustomerLoginGate } from '@/components/qr/customer-login-gate'

type Tier = { id: string; pay_amount: number; credit_amount: number }
type Transaction = { kind: string; amount: number; created_at: string }
const KIND_LABEL: Record<string, string> = { topup: 'Top-up', spend: 'Order payment', adjustment: 'Adjustment' }

export default function WalletClient({
  token,
  cafeId,
  cafeName,
  cafeLogo,
  tableLabel,
  timezone,
  tiers,
}: {
  token: string
  cafeId: string
  cafeName: string
  cafeLogo: string | null
  tableLabel: string
  timezone: string
  tiers: Tier[]
}) {
  const supabase = useMemo(() => createClient(), [])

  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [history, setHistory] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [toppingUp, setToppingUp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleSessionReady(session: CustomerSession) {
    setSessionToken(session.token)
  }

  const loadState = useCallback(
    async (st: string) => {
      setLoading(true)
      const { data, error: rpcError } = await supabase.rpc('customer_wallet_state', { p_session_token: st })
      setLoading(false)
      if (rpcError) {
        clearCustomerSession(cafeId)
        setSessionToken(null)
        return
      }
      const r = data as { balance: number; history: Transaction[] }
      setBalance(r.balance)
      setHistory(r.history)
    },
    [supabase, cafeId],
  )

  useEffect(() => {
    if (sessionToken) void loadState(sessionToken)
  }, [sessionToken, loadState])

  async function startTopup(tier: Tier) {
    if (!sessionToken) return
    setToppingUp(tier.id)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('wallet_start_topup', {
        p_session_token: sessionToken, p_tier_id: tier.id,
      })
      if (rpcError) {
        setToppingUp(null)
        return setError(rpcError.message)
      }
      const attempt = data as { attempt_id: string; pay_amount: number; credit_amount: number }

      const res = await fetch('/api/wallet/topup/create-order', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attempt_id: attempt.attempt_id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setToppingUp(null)
        return setError(body.error ?? 'Could not start the top-up. Please try again.')
      }
      const cfg = (await res.json()) as { key_id: string; order_id: string; amount: number; currency: string; name: string }

      const loaded = await loadRazorpayCheckout()
      if (!loaded || !window.Razorpay) {
        setToppingUp(null)
        return setError('Could not load the payment widget.')
      }

      const rzp = new window.Razorpay({
        key: cfg.key_id,
        order_id: cfg.order_id,
        amount: Math.round(cfg.amount * 100),
        currency: cfg.currency,
        name: cfg.name,
        description: `Wallet top-up — get ₹${attempt.credit_amount}`,
        theme: { color: '#C2410C' },
        handler: () => {
          // Razorpay confirms success client-side, but the balance only
          // actually changes once the verified webhook fires — poll for
          // that instead of trusting this callback.
          void (async () => {
            for (let i = 0; i < 10; i++) {
              await new Promise((r) => setTimeout(r, 1500))
              await loadState(sessionToken)
            }
            setToppingUp(null)
          })()
        },
        modal: { ondismiss: () => setToppingUp(null) },
      })
      rzp.on('payment.failed', () => {
        setError('Payment failed. Please try again.')
        setToppingUp(null)
      })
      rzp.open()
    } catch {
      setToppingUp(null)
      setError('Could not reach the payment service.')
    }
  }

  if (!sessionToken) {
    return (
      <CustomerLoginGate
        token={token}
        cafeId={cafeId}
        cafeName={cafeName}
        cafeLogo={cafeLogo}
        tableLabel={tableLabel}
        onReady={handleSessionReady}
      />
    )
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <Link href={`/t/${token}`} aria-label="Back to menu" className="text-muted-foreground">
            <ArrowLeft size={20} />
          </Link>
          <p className="text-[15px] font-semibold text-foreground">Wallet</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg px-5 py-6 pb-24">
        <div className="rounded-[var(--radius-lg)] border border-primary bg-primary-subtle p-5 text-center">
          <p className="text-[12px] font-medium uppercase tracking-wide text-primary">Balance at {cafeName}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {loading ? '…' : `₹${balance.toLocaleString('en-IN')}`}
          </p>
        </div>

        {error && (
          <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2.5 text-[13px] text-destructive">{error}</p>
        )}

        <div className="mt-6">
          <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Top up</p>
          {tiers.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-muted-foreground">No top-up options available right now.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {tiers.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
                      <PiggyBank size={16} />
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-foreground">Pay ₹{t.pay_amount}</p>
                      <p className="text-[12.5px] text-muted-foreground">
                        Get ₹{t.credit_amount}
                        {t.credit_amount > t.pay_amount && ` — ₹${t.credit_amount - t.pay_amount} bonus`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => startTopup(t)}
                    disabled={toppingUp !== null}
                    className="min-h-10 shrink-0 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {toppingUp === t.id ? 'Opening…' : 'Top up'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-8">
          <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Recent activity</p>
          {history.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-muted-foreground">No wallet activity yet.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {history.map((t, i) => (
                <li key={i} className="flex items-center justify-between rounded-[var(--radius)] border border-border px-3.5 py-2.5 text-[13px]">
                  <div>
                    <p className="text-foreground">{KIND_LABEL[t.kind] ?? t.kind}</p>
                    <p className="text-[11.5px] text-muted-foreground">{formatDayMonth(t.created_at, timezone)}</p>
                  </div>
                  <p className={`font-semibold ${t.amount >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {t.amount >= 0 ? '+' : ''}₹{t.amount.toLocaleString('en-IN')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <CustomerFooterNav token={token} />
    </div>
  )
}
