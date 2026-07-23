'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, ExternalLink, Copy } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/datetime'

type Detail = {
  order: {
    id: string
    invoice_number: string | null
    short_code: string
    created_at: string
    done_at: string | null
    order_type: string
    status: string
    payment_status: string
    payment_method: string | null
    table_label: string | null
    session_id: string | null
    customer_name: string | null
    phone_masked: string | null
    staff_name: string | null
    subtotal: number
    discount: number
    tax: number
    service_charge: number
    total: number
    cancel_reason: string | null
    receipt_token: string
    bill_status: string
  }
  items: {
    name: string; qty: number; price: number; hsn_sac: string | null
    tax_percent: number | null; taxable_value: number | null; tax_amount: number | null
    modifiers: { name: string; price: number }[] | null
    instructions: string | null
  }[]
  payments: { method: string; amount: number; created_at: string }[]
  refunds: { amount: number; method: string; kind: string; reason: string; status: string; created_at: string }[]
  session_orders: { id: string; short_code: string; total: number; created_at: string }[]
}

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

export function BillDetailDrawer({
  orderId,
  timezone,
  role,
  onClose,
}: {
  orderId: string
  timezone: string
  role: string
  onClose: () => void
  onChanged?: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data, error: err } = await supabase.rpc('bill_detail', { p_order_id: orderId })
      if (!alive) return
      if (err) return setError(err.message)
      setDetail(data as Detail)
    })()
    return () => { alive = false }
  }, [supabase, orderId])

  const o = detail?.order
  const billLink = o ? `${window.location.origin}/r/${o.receipt_token}` : ''
  const refunded = (detail?.refunds ?? []).filter((r) => r.status === 'completed').reduce((s, r) => s + r.amount, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-stretch sm:justify-end" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 sm:max-h-none sm:w-[520px] sm:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">
              {o?.invoice_number ?? (o ? `Order #${o.short_code}` : 'Bill')}
            </h2>
            {o && (
              <p className="text-[12.5px] text-muted-foreground">
                #{o.short_code} · {formatDateTime(o.created_at, timezone)}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}
        {!detail && !error && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}

        {detail && o && (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <Row k="Status" v={o.bill_status.replace(/_/g, ' ').toLowerCase()} />
              <Row k="Type" v={o.order_type === 'takeaway' ? 'Takeaway' : 'Dine-in'} />
              {o.order_type !== 'takeaway' && <Row k="Table" v={o.table_label ?? '—'} />}
              <Row k="Customer" v={[o.customer_name, o.phone_masked].filter(Boolean).join(' • ') || '—'} />
              <Row k="Staff" v={o.staff_name ?? '—'} />
              <Row k="Paid at" v={o.done_at ? formatDateTime(o.done_at, timezone) : '—'} />
            </dl>

            {o.cancel_reason && (
              <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">
                Cancelled — {o.cancel_reason}
              </p>
            )}

            <ul className="mt-4 divide-y divide-border border-y border-border">
              {detail.items.map((it, i) => (
                <li key={i} className="py-2.5">
                  <div className="flex justify-between gap-3 text-[13px]">
                    <span className="min-w-0 text-foreground">{it.qty} × {it.name}</span>
                    <span className="shrink-0 text-foreground">{money(it.price * it.qty)}</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {[
                      it.hsn_sac ? `HSN/SAC ${it.hsn_sac}` : null,
                      it.tax_percent != null ? `GST ${it.tax_percent}%` : null,
                      it.taxable_value != null ? `taxable ${money(it.taxable_value)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  {it.instructions && <p className="text-[11.5px] text-muted-foreground">“{it.instructions}”</p>}
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-1 text-[13px]">
              <Line k="Subtotal" v={money(o.subtotal)} />
              {o.discount > 0 && <Line k="Discount" v={`−${money(o.discount)}`} />}
              {o.tax > 0 && <><Line k="CGST" v={money(Math.floor(o.tax / 2))} /><Line k="SGST" v={money(o.tax - Math.floor(o.tax / 2))} /></>}
              {o.service_charge > 0 && <Line k="Service charge" v={money(o.service_charge)} />}
              <div className="flex justify-between border-t border-border pt-1.5 text-[15px] font-semibold text-foreground">
                <span>Total</span><span>{money(o.total)}</span>
              </div>
            </dl>

            {detail.payments.length > 0 && (
              <Section title="Payments">
                {detail.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-[12.5px] text-muted-foreground">
                    <span className="capitalize">{p.method}</span>
                    <span>{money(p.amount)} · {formatDateTime(p.created_at, timezone)}</span>
                  </div>
                ))}
              </Section>
            )}

            {detail.refunds.length > 0 && (
              <Section title={`Refunds — ${money(refunded)} total`}>
                {detail.refunds.map((r, i) => (
                  <div key={i} className="text-[12.5px] text-muted-foreground">
                    {money(r.amount)} · {r.kind} · {r.reason} <span className="opacity-70">({formatDateTime(r.created_at, timezone)})</span>
                  </div>
                ))}
              </Section>
            )}

            {o.session_id && detail.session_orders.length > 1 && (
              <Section title="Other orders on this table visit">
                {detail.session_orders.map((so) => (
                  <div key={so.id} className="flex justify-between text-[12.5px] text-muted-foreground">
                    <span>#{so.short_code}{so.id === o.id ? ' (this bill)' : ''}</span>
                    <span>{money(so.total)}</span>
                  </div>
                ))}
              </Section>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <a href={`/r/${o.receipt_token}`} target="_blank" rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground">
                <ExternalLink size={14} /> View digital bill
              </a>
              <button
                onClick={() => { void navigator.clipboard.writeText(billLink); toast('Bill link copied.') }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-medium text-foreground hover:bg-surface-subtle">
                <Copy size={14} /> Copy link
              </button>
            </div>

            {/* Refunds are issued from Live Tables, which already owns the
                audited refund_order flow. Duplicating it here would mean two
                code paths writing the same financial record. */}
            {(role === 'owner' || role === 'manager') && o.bill_status === 'PAID' && (
              <p className="mt-3 text-[12px] text-muted-foreground">
                To refund this bill, open it from Live tables — refunds run through the audited refund flow there.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className="text-foreground first-letter:uppercase">{v}</dd>
    </div>
  )
}
function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-muted-foreground"><span>{k}</span><span>{v}</span></div>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-1.5 space-y-1">{children}</div>
    </div>
  )
}
