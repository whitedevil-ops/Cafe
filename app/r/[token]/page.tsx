import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { formatDateTime, DEFAULT_TIMEZONE } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

type Receipt = {
  cafe: { name: string; address: string | null; city: string | null; gstin: string | null; logo_url: string | null; phone: string | null; timezone: string | null }
  order: {
    short_code: string
    created_at: string
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
  items: { name: string; qty: number; price: number; modifiers: { name: string; price: number }[] }[]
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
          {(r.cafe.address || r.cafe.city) && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {[r.cafe.address, r.cafe.city].filter(Boolean).join(', ')}
            </p>
          )}
          {r.cafe.gstin && <p className="text-[12px] text-muted-foreground">GSTIN: {r.cafe.gstin}</p>}
        </header>

        <div className="flex flex-wrap justify-between gap-2 border-b border-border py-3 text-[13px] text-muted-foreground">
          <span>Order #{r.order.short_code}</span>
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
          {r.order.tax > 0 && (
            <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>₹{r.order.tax}</span></div>
          )}
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
