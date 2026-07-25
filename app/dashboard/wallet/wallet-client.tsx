'use client'

import { useMemo, useState } from 'react'
import { PiggyBank, Plus, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { formatDayMonth } from '@/lib/datetime'

export type Tier = { id: string; pay_amount: number; credit_amount: number; active: boolean; sort: number }
export type WalletRow = { customer_id: string; name: string | null; phone: string | null; balance: number }
export type WalletOverview = { total_outstanding: number; wallets: WalletRow[] }
type Transaction = { id: string; kind: string; amount: number; reason: string | null; created_at: string }

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label="Active" disabled={disabled} onClick={onClick}
      className={`h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'}`}
    >
      <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

const KIND_LABEL: Record<string, string> = { topup: 'Top-up', spend: 'Order payment', adjustment: 'Adjustment' }

export default function WalletClient({
  cafeId,
  role,
  timezone,
  initialTiers,
  initialOverview,
}: {
  cafeId: string
  role: string
  timezone: string
  initialTiers: Tier[]
  initialOverview: WalletOverview
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const isAdmin = role === 'owner' || role === 'manager'

  const [tiers, setTiers] = useState(initialTiers)
  const [payAmount, setPayAmount] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [savingTier, setSavingTier] = useState(false)
  const [tierError, setTierError] = useState<string | null>(null)

  const [overview, setOverview] = useState(initialOverview)

  const [adjustPhone, setAdjustPhone] = useState('')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)

  const [selected, setSelected] = useState<WalletRow | null>(null)
  const [history, setHistory] = useState<Transaction[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  async function refreshOverview() {
    const { data } = await supabase.rpc('wallet_overview', { p_cafe_id: cafeId })
    if (data) setOverview(data as WalletOverview)
  }

  async function createTier() {
    const pay = Math.round(Number(payAmount))
    const credit = Math.round(Number(creditAmount))
    if (!pay || pay <= 0) return setTierError('Pay amount must be greater than 0.')
    if (!credit || credit < pay) return setTierError('Credit amount cannot be less than the pay amount.')
    setSavingTier(true)
    setTierError(null)
    const { data, error } = await supabase.rpc('create_wallet_tier', {
      p_cafe_id: cafeId, p_pay_amount: pay, p_credit_amount: credit,
    })
    setSavingTier(false)
    if (error) return setTierError(error.message)
    setTiers((list) => [...list, { id: data as string, pay_amount: pay, credit_amount: credit, active: true, sort: list.length }])
    setPayAmount('')
    setCreditAmount('')
    toast(`Tier created: pay ₹${pay} → get ₹${credit}.`)
  }

  async function toggleTier(t: Tier) {
    setTiers((list) => list.map((x) => (x.id === t.id ? { ...x, active: !x.active } : x)))
    const { error } = await supabase.rpc('set_wallet_tier_active', { p_tier_id: t.id, p_active: !t.active })
    if (error) {
      setTiers((list) => list.map((x) => (x.id === t.id ? { ...x, active: t.active } : x)))
      toast(error.message, 'error')
    }
  }

  async function adjustWallet() {
    const amt = Math.round(Number(adjustAmount))
    if (!adjustPhone.trim()) return setAdjustError('Enter the customer’s phone number.')
    if (!amt) return setAdjustError('Enter a non-zero amount.')
    if (!adjustReason.trim()) return setAdjustError('A reason is required.')
    setAdjusting(true)
    setAdjustError(null)

    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('cafe_id', cafeId)
      .eq('phone', adjustPhone.trim())
      .maybeSingle()
    if (!customer) {
      setAdjusting(false)
      return setAdjustError('No customer found with this phone number.')
    }

    const { data, error } = await supabase.rpc('wallet_adjust', {
      p_cafe_id: cafeId, p_customer_id: customer.id, p_amount: amt, p_reason: adjustReason.trim(),
    })
    setAdjusting(false)
    if (error) return setAdjustError(error.message)
    toast(`Done — new balance is ₹${data as number}.`)
    setAdjustPhone('')
    setAdjustAmount('')
    setAdjustReason('')
    void refreshOverview()
  }

  async function openWallet(w: WalletRow) {
    setSelected(w)
    setLoadingHistory(true)
    const { data } = await supabase
      .from('wallet_transactions')
      .select('id, kind, amount, reason, created_at')
      .eq('cafe_id', cafeId)
      .eq('customer_id', w.customer_id)
      .order('created_at', { ascending: false })
      .limit(30)
    setHistory((data ?? []) as Transaction[])
    setLoadingHistory(false)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        title="Wallet"
        subtitle="Customers prepay online for a bonus credit, then spend the balance at future visits — money stored at this café only."
      />

      {!isAdmin && (
        <p className="mt-4 rounded-[var(--radius)] bg-warning-subtle px-3 py-2.5 text-[13px] text-warning">
          View only — your role ({role}) can’t change top-up tiers or adjust balances.
        </p>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Outstanding balance"
          description="Total stored value across every customer wallet — money already collected that customers haven't spent yet."
        />
        <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          ₹{overview.total_outstanding.toLocaleString('en-IN')}
        </p>
      </Card>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader title="Top-up tiers" description="What a customer pays, and what gets credited — the difference is their bonus." />
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <Input label="Customer pays (₹)" type="number" min={1} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="3000" className="max-w-[160px]" />
            <Input label="Customer gets (₹)" type="number" min={1} value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="3200" className="max-w-[160px]" />
            <Button loading={savingTier} onClick={createTier}><Plus size={14} /> Add tier</Button>
          </div>
          {tierError && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{tierError}</p>}

          <div className="mt-5">
            {tiers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No top-up tiers yet — customers can&apos;t top up until you add one.</p>
            ) : (
              <ul className="space-y-2">
                {tiers.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-4 py-3">
                    <p className="text-[13.5px] text-foreground">
                      Pay <span className="font-semibold">₹{t.pay_amount}</span> → get{' '}
                      <span className="font-semibold text-primary">₹{t.credit_amount}</span>
                      {t.credit_amount > t.pay_amount && (
                        <span className="ml-1.5 text-[12px] text-muted-foreground">
                          (+₹{t.credit_amount - t.pay_amount} bonus)
                        </span>
                      )}
                    </p>
                    <Toggle on={t.active} disabled={!isAdmin} onClick={() => toggleTier(t)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      <div className="mt-8">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Customer wallets</p>
        {overview.wallets.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No customer has a wallet balance yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {overview.wallets.map((w) => (
              <li key={w.customer_id}>
                <button
                  onClick={() => openWallet(w)}
                  className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-left hover:border-border-strong"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
                      <PiggyBank size={16} />
                    </div>
                    <div>
                      <p className="text-[13.5px] font-medium text-foreground">{w.name || 'Unnamed customer'}</p>
                      <p className="text-[12px] text-muted-foreground">{w.phone ?? '—'}</p>
                    </div>
                  </div>
                  <p className="text-[14px] font-semibold text-foreground">₹{w.balance.toLocaleString('en-IN')}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isAdmin && (
        <Card className="mt-8">
          <CardHeader title="Adjust a customer's balance" description="For goodwill credit or fixing a mistake — every adjustment needs a reason." />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Input label="Customer phone" inputMode="numeric" value={adjustPhone} onChange={(e) => setAdjustPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            <Input label="Amount (₹, ± )" type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="e.g. 100 or -100" />
            <Input label="Reason" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Service recovery" />
          </div>
          {adjustError && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{adjustError}</p>}
          <Button className="mt-4" variant="secondary" loading={adjusting} onClick={adjustWallet}>Apply adjustment</Button>
        </Card>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={() => setSelected(null)}>
          <div
            className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:max-h-[75dvh] sm:rounded-[var(--radius-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[16px] font-semibold text-foreground">{selected.name || 'Unnamed customer'}</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{selected.phone ?? '—'} · Balance ₹{selected.balance.toLocaleString('en-IN')}</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center text-muted-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Transaction history</p>
              {loadingHistory ? (
                <p className="mt-2 text-[13px] text-muted-foreground">Loading…</p>
              ) : history.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">No transactions yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {history.map((t) => (
                    <li key={t.id} className="flex items-center justify-between rounded-[var(--radius)] border border-border px-3 py-2 text-[13px]">
                      <div className="min-w-0">
                        <p className="text-foreground">{KIND_LABEL[t.kind] ?? t.kind}{t.reason ? ` — ${t.reason}` : ''}</p>
                        <p className="text-[11.5px] text-muted-foreground">{formatDayMonth(t.created_at, timezone)}</p>
                      </div>
                      <p className={`shrink-0 font-semibold ${t.amount >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {t.amount >= 0 ? '+' : ''}₹{t.amount.toLocaleString('en-IN')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
