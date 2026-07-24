'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wallet, CreditCard, Landmark, Coins, Info, Check, Copy, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

export type PaymentsConfig = {
  accept_cash: boolean
  accept_upi_counter: boolean
  accept_card_counter: boolean
  accept_pay_counter: boolean
  online_payments_enabled: boolean
  razorpay_status: 'not_connected' | 'pending' | 'connected' | 'disabled'
  razorpay_key_id: string | null
  razorpay_webhook_token: string | null
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
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'}`}>
      <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export function PaymentsPanel({
  cafeId,
  value,
  onChange,
  disabled,
}: {
  cafeId: string
  value: PaymentsConfig
  onChange: (patch: Partial<PaymentsConfig>) => void
  disabled: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const connected = value.razorpay_status === 'connected'
  const rzp = RZP_BADGE[value.razorpay_status]

  const [showForm, setShowForm] = useState(false)
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const webhookUrl =
    typeof window !== 'undefined' && value.razorpay_webhook_token
      ? `${window.location.origin}/api/payments/razorpay/webhook/${value.razorpay_webhook_token}`
      : ''

  async function connect() {
    setBusy(true)
    setErr(null)
    const res = await fetch('/api/payments/razorpay/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId, key_id: keyId.trim(), key_secret: keySecret.trim(), webhook_secret: webhookSecret.trim() }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setErr(body.error ?? 'Could not connect. Check your keys and try again.')
    setKeySecret('')
    setWebhookSecret('')
    setShowForm(false)
    toast('Razorpay connected.')
    router.refresh() // re-fetch the true connected state + webhook token
  }

  async function disconnect() {
    setBusy(true)
    const res = await fetch('/api/payments/razorpay/disconnect', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cafe_id: cafeId }),
    })
    setBusy(false)
    if (!res.ok) { const b = await res.json().catch(() => ({})); return toast(b.error ?? 'Could not disconnect.', 'error') }
    toast('Razorpay disconnected.')
    router.refresh()
  }

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
              <Toggle on={Boolean(value[m.key])} disabled={disabled} onClick={() => onChange({ [m.key]: !value[m.key] } as Partial<PaymentsConfig>)} label={m.label} />
            </li>
          ))}
        </ul>
      </div>

      {/* Online payments — Razorpay (each café connects its own account) */}
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
                Connect your own Razorpay account to accept UPI, cards and wallets online. Money settles straight to
                your bank. Payments are confirmed automatically — never by a customer tapping a button.
              </p>
            </div>
            {!disabled && (
              connected ? (
                <button type="button" onClick={disconnect} disabled={busy} className="min-h-9 shrink-0 rounded-[var(--radius)] border border-border-strong px-4 text-[12.5px] font-medium text-destructive hover:bg-destructive-subtle disabled:opacity-50">Disconnect</button>
              ) : (
                <button type="button" onClick={() => { setShowForm((v) => !v); setErr(null) }} className="min-h-9 shrink-0 rounded-[var(--radius)] bg-primary px-4 text-[12.5px] font-medium text-primary-foreground hover:bg-primary-hover">Connect Razorpay</button>
              )
            )}
          </div>

          {/* Connected: show which key + the webhook URL to paste into Razorpay */}
          {connected && (
            <div className="mt-3 space-y-3">
              {value.razorpay_key_id && (
                <p className="text-[12.5px] text-muted-foreground">Connected as <span className="font-medium text-foreground">{value.razorpay_key_id}</span></p>
              )}
              <label className="flex items-center gap-2 text-[13px] text-foreground">
                <input type="checkbox" checked={value.online_payments_enabled} disabled={disabled} onChange={(e) => onChange({ online_payments_enabled: e.target.checked })} />
                Show “Pay online” on the customer QR checkout
              </label>
              {webhookUrl && (
                <div className="rounded-[var(--radius)] bg-surface-subtle p-3">
                  <p className="text-[12px] font-medium text-foreground">Your webhook URL</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">In your Razorpay dashboard → Settings → Webhooks, add this URL and subscribe to <strong>payment.captured</strong>, using the same webhook secret you entered here.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded border border-border bg-surface px-2 py-1.5 text-[11.5px] text-foreground">{webhookUrl}</code>
                    <button type="button" onClick={() => { void navigator.clipboard.writeText(webhookUrl); toast('Webhook URL copied.') }} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] border border-border-strong text-muted-foreground hover:bg-surface"><Copy size={14} /></button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connect form */}
          {showForm && !connected && (
            <div className="mt-3 rounded-[var(--radius)] border border-border bg-surface-subtle p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground"><Check size={15} className="text-primary" /> Enter your Razorpay keys</p>
                <button type="button" onClick={() => setShowForm(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                From your Razorpay dashboard → Account &amp; Settings → API Keys. Your secret is encrypted and never shown again.
                Create a webhook there first if you want its secret; you can add it later too.
              </p>
              <div className="mt-3 space-y-3">
                <Input label="Key ID" placeholder="rzp_live_XXXXXXXX" value={keyId} onChange={(e) => setKeyId(e.target.value)} />
                <Input label="Key Secret" type="password" placeholder="••••••••" value={keySecret} onChange={(e) => setKeySecret(e.target.value)} hint="Encrypted at rest. Never displayed again." />
                <Input label="Webhook Secret (optional)" type="password" placeholder="••••••••" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} hint="The signing secret you set on the Razorpay webhook. Needed for automatic confirmation." />
              </div>
              {err && <p className="mt-2 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{err}</p>}
              <button type="button" onClick={connect} disabled={busy || !keyId.trim() || !keySecret.trim()} className="mt-3 min-h-10 w-full rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground disabled:opacity-50">
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          )}

          {!connected && !showForm && (
            <div className="mt-3 flex items-start gap-2 rounded-[var(--radius)] bg-info-subtle px-3 py-2.5 text-[12.5px] text-info">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span>You’ll need a Razorpay account (razorpay.com) and its API keys. Until connected, customers pay at the counter.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
