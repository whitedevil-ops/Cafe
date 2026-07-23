import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { formatDateTime, DEFAULT_TIMEZONE } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

type Receipt = {
  cafe: {
    name: string; legal_name: string | null; trade_name: string | null
    address: string | null; city: string | null; state: string | null; pincode: string | null
    gstin: string | null; logo_url: string | null; phone: string | null
    gst_registered: boolean; tax_inclusive: boolean; timezone: string | null
  }
  order: {
    short_code: string
    created_at: string
    order_type: string
    payment_status: string
    payment_method: string | null
    subtotal: number
    discount: number
    tax: number
    service_charge: number
    total: number
    coupon_code: string | null
    table_label: string | null
    phone_masked: string | null
  }
  gst_invoice: {
    invoice_number: string
    issued_at: string
    taxable_amount: number
    cgst: number
    sgst: number
    place_of_supply: string
  } | null
  items: {
    name: string; qty: number; price: number; modifiers: { name: string; price: number }[]
    hsn_sac: string | null; tax_percent: number | null; taxable_value: number | null; tax_amount: number | null
  }[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID_RE.test(token)) notFound()

  const supabase = await createClient()
  const { data } = await supabase.rpc('get_receipt', { p_token: token })
  if (!data) notFound()
  const r = data as Receipt

  // This page renders on the server, where the runtime clock is UTC. Formatting
  // without an explicit zone printed the bill 5h30m early — the reported bug.
  const when = formatDateTime(r.order.created_at, r.cafe.timezone ?? DEFAULT_TIMEZONE)

  return (
    <main className="mx-auto w-full min-h-dvh max-w-md bg-background px-5 py-8">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <header className="border-b border-border pb-4 text-center">
          {r.cafe.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.cafe.logo_url} alt="" className="mx-auto mb-2 h-12 w-12 rounded-lg object-cover" />
          )}
          <h1 className="text-lg font-semibold text-foreground">{r.cafe.name}</h1>
          {r.cafe.gst_registered && r.cafe.legal_name && r.cafe.legal_name !== r.cafe.name && (
            <p className="text-[12px] text-muted-foreground">{r.cafe.legal_name}</p>
          )}
          {(r.cafe.address || r.cafe.city) && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {[r.cafe.address, r.cafe.city, r.cafe.state, r.cafe.pincode].filter(Boolean).join(', ')}
            </p>
          )}
          {/* Only meaningful for a registered café — never shown otherwise. */}
          {r.cafe.gst_registered && r.cafe.gstin && (
            <p className="text-[12px] text-muted-foreground">GSTIN: {r.cafe.gstin}</p>
          )}
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-foreground">
            {r.gst_invoice ? 'Tax Invoice' : 'Receipt'}
          </p>
        </header>

        {r.gst_invoice && (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border py-3 text-[12px] text-muted-foreground">
            <span>Invoice: <span className="text-foreground">{r.gst_invoice.invoice_number}</span></span>
            <span>Place of supply: {r.gst_invoice.place_of_supply}</span>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-b border-border py-3 text-[13px] text-muted-foreground">
          <span>Order #{r.order.short_code}</span>
          <span>{r.order.order_type === 'takeaway' ? 'Takeaway' : 'Dine-in'}</span>
          {r.order.table_label && <span>Table {r.order.table_label}</span>}
          <span>{when}</span>
        </div>
        {r.order.phone_masked && (
          <p className="border-b border-border py-2 text-[13px] text-muted-foreground">
            Customer: {r.order.phone_masked}
          </p>
        )}

        <ul className="divide-y divide-border">
          {r.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="text-foreground">{it.qty} × {it.name}</p>
                {it.modifiers?.length > 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    {it.modifiers.map((m) => m.name).join(', ')}
                  </p>
                )}
                {r.gst_invoice && (
                  <p className="text-[11px] text-muted-foreground">
                    {[
                      it.hsn_sac ? `HSN/SAC ${it.hsn_sac}` : null,
                      it.tax_percent != null ? `GST ${it.tax_percent}%` : null,
                      it.taxable_value != null ? `taxable ₹${it.taxable_value}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-foreground">₹{it.price * it.qty}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 border-t border-border pt-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span><span>₹{r.order.subtotal}</span>
          </div>
          {r.order.discount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Discount{r.order.coupon_code ? ` (${r.order.coupon_code})` : ''}</span>
              <span>−₹{r.order.discount}</span>
            </div>
          )}
          {r.gst_invoice && (
            <div className="flex justify-between text-muted-foreground">
              <span>Taxable amount</span><span>₹{r.gst_invoice.taxable_amount}</span>
            </div>
          )}
          {r.order.tax > 0 && r.gst_invoice ? (
            <>
              <div className="flex justify-between text-muted-foreground"><span>CGST</span><span>₹{r.gst_invoice.cgst}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>SGST</span><span>₹{r.gst_invoice.sgst}</span></div>
              {r.cafe.tax_inclusive && (
                <p className="text-[11px] text-muted-foreground">(GST included in the prices above)</p>
              )}
            </>
          ) : r.order.tax > 0 ? (
            <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>₹{r.order.tax}</span></div>
          ) : null}
          {r.order.service_charge > 0 && (
            <div className="flex justify-between text-muted-foreground"><span>Service charge</span><span>₹{r.order.service_charge}</span></div>
          )}
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-foreground">
            <span>Total</span><span>₹{r.order.total}</span>
          </div>
          <div className="flex justify-between pt-1 text-[13px] text-muted-foreground">
            <span>{r.order.payment_method === 'card' ? 'Card' : r.order.payment_method === 'cash' ? 'Cash' : 'Pay at counter'}</span>
            <span className={r.order.payment_status === 'paid' ? 'font-medium text-success' : ''}>
              {r.order.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
            </span>
          </div>
        </div>

        <p className="mt-5 border-t border-border pt-4 text-center text-[12px] text-muted-foreground">
          Thank you for visiting!
        </p>
      </div>
    </main>
  )
}
