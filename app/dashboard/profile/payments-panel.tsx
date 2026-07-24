'use client'

import { useState } from 'react'
import { Wallet, CreditCard, Landmark, Coins, Info, X } from 'lucide-react'

export type PaymentsConfig = {
  accept_cash: boolean
  accept_upi_counter: boolean
  accept_card_counter: boolean
  accept_pay_counter: boolean
  online_payments_enabled: boolean
  razorpay_status: 'not_connected' | 'pending' | 'connected' | 'disabled'
}

const METHODS: { key: keyof PaymentsConfig; label: string; sub: string; icon: React.ReactNode }[] = [
  { key: 'accept_cash', label: 'Cash', sub: 'Recorded at the counter', icon: <Coins size={16} /> },
  { key: 'accept_upi_counter', label: 'UPI at counter', sub: 'Customer pays your UPI directly; staff record it', icon: <Landmark size={16} /> },
  { key: 'accept_card_counter', label: 'Card at counter', sub: 'Card machine at the counter', icon: <CreditCard size={16} /> },
  { key: 'accept_pay_counter', label: 'Pay at counter (QR menu)', sub: 'Let QR customers order now and pay later', icon: <Wallet size={16} /> },
]

const RZP_BADGE: Record<PaymentsConfig['razorpay_status'], { label: string; cls: string }> = {
  not_connected: { label: 'Not connected', cls: 'bg-surface-subtle text-muted-foreground border-border-strong' },
  pending: { label: 'Pending', cls: 'bg-warning-subtle text-warning border-warning' },
  connected: { label: 'Connected', cls: 'bg-success-subtle text-success border-success' },
  disabled: { label: 'Disabled', cls: 'bg-destructive-subtle text-destructive border-destructive' },
}

function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'}`}
    >
      <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export function PaymentsPanel({
  value,
  onChange,
  disabled,
}: {
  value: PaymentsConfig
  onChange: (patch: Partial<PaymentsConfig>) => void
  disabled: boolean
}) {
  const connected = value.razorpay_status === 'connected'
  const rzp = RZP_BADGE[value.razorpay_status]
  const [showSetup, setShowSetup] = useState(false)

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Payments</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        How you accept money. Your café works fully on counter payments — online payment is optional.
      </p>

      {/* Counter payment methods */}
      <div className="mt-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Payment methods</p>
        <ul className="mt-2 divide-y divide-border rounded-[var(--radius)] border border-border">
          {METHODS.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="text-muted-foreground">{m.icon}</span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-foreground">{m.label}</p>
                  <p className="text-[12px] text-muted-foreground">{m.sub}</p>
                </div>
              </div>
              <Toggle
                on={Boolean(value[m.key])}
                disabled={disabled}
                onClick={() => onChange({ [m.key]: !value[m.key] } as Partial<PaymentsConfig>)}
                label={m.label}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Online payments — Razorpay */}
      <div className="mt-6">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Online payments</p>
        <div className="mt-2 rounded-[var(--radius)] border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[13.5px] font-medium text-foreground">Razorpay</p>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${rzp.cls}`}>{rzp.label}</span>
              </div>
              <p className="mt-0.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                Accept automatically-verified online payments (UPI, cards, wallets) from the QR menu. Money settles to
                your own bank account.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSetup((v) => !v)}
              className="min-h-9 shrink-0 rounded-[var(--radius)] border border-border-strong px-4 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle"
            >
              {connected ? 'Manage' : 'Connect Razorpay'}
            </button>
          </div>

          {value.online_payments_enabled && connected && (
            <label className="mt-3 flex items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={value.online_payments_enabled}
                disabled={disabled}
                onChange={(e) => onChange({ online_payments_enabled: e.target.checked })}
              />
              Show “Pay online” on the customer QR checkout
            </label>
          )}

          {showSetup && !connected && (
            <div className="mt-3 rounded-[var(--radius)] border border-info bg-info-subtle p-3.5 text-[12.5px] text-info">
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold"><Info size={15} /> Online payments aren’t live yet</p>
                <button type="button" onClick={() => setShowSetup(false)} aria-label="Dismiss" className="shrink-0 text-info/70 hover:text-info"><X size={14} /></button>
              </div>
              <p className="mt-1.5 leading-relaxed">
                Accepting online payments needs a one-time setup at the <strong>KhaoPiyo platform level</strong> — it
                isn’t something a single café can switch on. Once that’s done, connecting your café here takes a couple
                of minutes.
              </p>
              <p className="mt-2 font-medium">What the platform owner sets up first:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>A Razorpay platform account with <strong>Route</strong> enabled</li>
                <li>Platform API keys + webhook secret (kept server-side, never shared)</li>
              </ul>
              <p className="mt-2 font-medium">Then, to connect your café:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Your business + bank details (KYC), verified by a small test deposit</li>
                <li>Money then settles straight to your own bank account</li>
              </ul>
              <p className="mt-2">Until then, customers pay at the counter — everything else works normally.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
