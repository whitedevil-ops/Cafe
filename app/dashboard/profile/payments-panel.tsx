'use client'

import { useState } from 'react'
import { Landmark, ExternalLink, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { uploadPaymentQr } from '@/lib/image-upload'

export type PaymentsConfig = {
  upi_enabled: boolean
  upi_id: string
  upi_name: string
  payment_qr_url: string | null
  qr_payment_mode: 'pay_later' | 'prepaid' | 'both'
}

const MODES: { v: PaymentsConfig['qr_payment_mode']; label: string; sub: string }[] = [
  { v: 'pay_later', label: 'Pay at counter only', sub: 'Customers order, then pay you directly' },
  { v: 'prepaid', label: 'Prepaid only', sub: 'Customers must pay online before it reaches the kitchen' },
  { v: 'both', label: 'Let customers choose', sub: 'Show both “Pay now” and “Pay at counter”' },
]

// Server stays authoritative: the UPI ID is the payment configuration, not the
// uploaded QR image. The QR is a convenience for scanning; if a UPI ID exists,
// the app builds the intent from it (with the server-computed amount).
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
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const upiValid = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(value.upi_id.trim())

  async function pickQr(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    const res = await uploadPaymentQr(cafeId, file)
    setUploading(false)
    if ('error' in res) return setUploadError(res.error)
    onChange({ payment_qr_url: res.url })
  }

  function testLink() {
    const uri = `upi://pay?pa=${encodeURIComponent(value.upi_id.trim())}&pn=${encodeURIComponent(value.upi_name.trim() || 'Café')}&am=1&cu=INR&tn=KhaoPiyo%20test`
    window.location.href = uri
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Payments</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        How customers pay you. Cash, card and “pay at counter” are always available — this controls UPI.
      </p>

      {/* Always-on methods, for reassurance */}
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {['Cash', 'Card', 'Pay at counter'].map((m) => (
          <li key={m} className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-2 text-[12.5px] text-muted-foreground">
            <Check size={13} className="text-success" /> {m}
          </li>
        ))}
      </ul>

      {/* UPI enable */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius)] border border-border p-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13.5px] font-medium text-foreground"><Landmark size={16} /> UPI payments</h3>
          <p className="mt-0.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
            Let customers pay to your UPI ID from the QR menu. KhaoPiyo shows the exact amount and opens their UPI app —
            it never handles their PIN and does not process the money itself.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={value.upi_enabled}
          aria-label="UPI payments"
          disabled={disabled}
          onClick={() => onChange({ upi_enabled: !value.upi_enabled })}
          className={`h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${value.upi_enabled ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'}`}
        >
          <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${value.upi_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {value.upi_enabled && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="UPI ID / VPA"
              placeholder="breworacafe@upi"
              value={value.upi_id}
              onChange={(e) => onChange({ upi_id: e.target.value })}
              disabled={disabled}
              error={value.upi_id.trim() && !upiValid ? 'That doesn’t look like a UPI ID (e.g. name@bank).' : undefined}
              hint={!value.upi_id.trim() ? 'Required to accept UPI.' : upiValid ? 'Looks valid.' : undefined}
            />
            <Input
              label="Payee name"
              placeholder="Brewora Café"
              value={value.upi_name}
              onChange={(e) => onChange({ upi_name: e.target.value })}
              disabled={disabled}
              hint="Shown in the customer’s UPI app."
            />
          </div>

          <div>
            <p className="text-[13px] font-medium text-foreground">Payment QR (optional)</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">A scannable image for desktop customers. The UPI ID above stays the source of truth.</p>
            <div className="mt-2 flex items-center gap-4">
              {value.payment_qr_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={value.payment_qr_url} alt="Payment QR" className="h-20 w-20 rounded-[var(--radius)] border border-border object-contain bg-white p-1" />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-[var(--radius)] border border-dashed border-border-strong text-[11px] text-muted-foreground">No QR</div>
              )}
              {!disabled && (
                <div className="flex flex-col gap-1.5">
                  <label className="inline-flex min-h-9 cursor-pointer items-center rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">
                    {uploading ? 'Uploading…' : value.payment_qr_url ? 'Replace QR' : 'Upload QR'}
                    <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => pickQr(e.target.files?.[0])} />
                  </label>
                  {value.payment_qr_url && (
                    <button type="button" onClick={() => onChange({ payment_qr_url: null })} className="min-h-8 px-1 text-left text-[12px] text-muted-foreground hover:text-destructive">Remove</button>
                  )}
                </div>
              )}
            </div>
            {uploadError && <p className="mt-2 text-[12px] text-destructive">{uploadError}</p>}
          </div>

          {upiValid && (
            <button type="button" onClick={testLink} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">
              <ExternalLink size={14} /> Test payment link (₹1)
            </button>
          )}
        </div>
      )}

      {/* QR ordering payment mode */}
      <div className="mt-5">
        <p className="text-[13px] font-medium text-foreground">QR ordering — how customers pay</p>
        <div className="mt-2 space-y-2">
          {MODES.map((m) => {
            const on = value.qr_payment_mode === m.v
            const needsUpi = m.v !== 'pay_later' && !value.upi_enabled
            return (
              <button
                key={m.v}
                type="button"
                disabled={disabled || needsUpi}
                onClick={() => onChange({ qr_payment_mode: m.v })}
                className={`flex w-full items-center gap-3 rounded-[var(--radius)] border px-4 py-3 text-left disabled:opacity-50 ${
                  on ? 'border-primary bg-primary-subtle' : 'border-border-strong hover:bg-surface-subtle'
                }`}
              >
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${on ? 'border-primary' : 'border-border-strong'}`}>
                  {on && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13px] font-medium ${on ? 'text-primary' : 'text-foreground'}`}>{m.label}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{needsUpi ? 'Enable UPI above to use this' : m.sub}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
