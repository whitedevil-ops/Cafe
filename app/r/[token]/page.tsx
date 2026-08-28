import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { formatDateTime, DEFAULT_TIMEZONE } from '@/lib/datetime'
import { resolvePaymentState, RECEIPT_STATE_LABEL, methodLabel } from '@/lib/receipt-status'
import { FeedbackForm } from '@/components/receipt/feedback-form'
import { ReceiptDownloadButton } from '@/components/receipt/download-button'
import { AutoPrint } from '@/components/receipt/auto-print'
import { SpinWheel } from '@/components/qr/spin-wheel'
import type { ReceiptData } from '@/lib/pdf-export'

export const dynamic = 'force-dynamic'

type Receipt = ReceiptData

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Stamp treatment per resolved state — colour comes from the app's own
// existing tokens (globals.css), never a one-off hex, so the stamp stays on
// brand in both themes automatically. print-color-adjust keeps the tint and
// rotation alive in a printed/PDF-exported copy rather than being stripped
// the way browsers strip low-opacity colour from print output by default.
const STAMP_TEXT_CLASS: Record<string, string> = {
  paid: 'text-success',
  partial: 'text-warning',
  failed: 'text-destructive',
  unpaid: 'text-destructive',
  refunded: 'text-muted-foreground',
}
// Border colour is set inline rather than via a border-{token} utility class —
// Tailwind's JIT here resolves text-{token} colours fine but not
// border-{token} ones for these theme tokens, so the class silently falls
// back to the generic --border colour. Same CSS variables either way.
const STAMP_BORDER_VAR: Record<string, string> = {
  paid: 'var(--success)',
  partial: 'var(--warning)',
  failed: 'var(--destructive)',
  unpaid: 'var(--destructive)',
  refunded: 'var(--border-strong)',
}

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID_RE.test(token)) notFound()

  const supabase = await createClient()
  const { data } = await supabase.rpc('get_receipt', { p_token: token })
  if (!data) notFound()
  const r = data as Receipt
  // Defensive against get_receipt not having shipped the payments/credit_notes
  // fields yet (migration 0160) on whichever environment this runs against —
  // never crash a customer's bill page over a rollout-ordering gap.
  const payments = r.payments ?? []
  const creditNotes = r.credit_notes ?? []

  // This page renders on the server, where the runtime clock is UTC. Formatting
  // without an explicit zone printed the bill 5h30m early — the reported bug.
  const tz = r.cafe.timezone ?? DEFAULT_TIMEZONE
  const when = formatDateTime(r.order.created_at, tz)

  const state = resolvePaymentState(r.order.payment_status, payments)
  const stateLabel = RECEIPT_STATE_LABEL[state]
  const paidSoFar = payments.filter((p) => p.status === 'captured').reduce((s, p) => s + p.amount, 0)
  const due = Math.max(0, r.order.total - paidSoFar)
  // The payment worth showing method/reference/time for — the most recent
  // captured one if there is one, otherwise the most recent attempt at all
  // (e.g. the failed one), so a failed bill still shows what was tried.
  const captured = payments.filter((p) => p.status === 'captured')
  const shownPayment = captured[captured.length - 1] ?? payments[payments.length - 1] ?? null
  const billNumber = r.gst_invoice?.invoice_number ?? r.order.short_code

  return (
    <main className="mx-auto w-full min-h-dvh max-w-md bg-background px-4 py-8 sm:px-5 print:min-h-0 print:max-w-full print:px-0 print:py-0">
      <AutoPrint />
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-sm print:rounded-none print:border-0 print:bg-transparent print:shadow-none">
        {/* ── Payment status stamp — rotated, translucent, behind the
            content. Sized down on very small screens so it never forces
            horizontal scroll. print-color-adjust keeps it alive in Print/PDF. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
          <div
            className={`select-none whitespace-nowrap rounded-md px-5 py-2 text-[9vw] font-black uppercase tracking-[0.18em] opacity-[0.14] sm:px-7 sm:py-2.5 sm:text-4xl ${STAMP_TEXT_CLASS[state]}`}
            style={{
              fontFamily: 'var(--font-display)',
              transform: 'rotate(-16deg)',
              border: `5px solid ${STAMP_BORDER_VAR[state]}`,
            }}
          >
            {stateLabel}
          </div>
        </div>

        <div className="relative z-10 p-6 print:p-0">
          <header className="border-b border-border pb-4 text-center">
            {r.cafe.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.cafe.logo_url} alt="" className="mx-auto mb-2.5 h-14 w-14 rounded-xl object-cover shadow-sm" />
            )}
            <h1 className="text-xl font-bold tracking-tight text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              {r.cafe.name}
            </h1>
            {r.cafe.gst_registered && r.cafe.legal_name && r.cafe.legal_name !== r.cafe.name && (
              <p className="mt-0.5 text-[12px] text-muted-foreground">{r.cafe.legal_name}</p>
            )}
            {(r.cafe.address || r.cafe.city) && (
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {[r.cafe.address, r.cafe.city, r.cafe.state, r.cafe.pincode].filter(Boolean).join(', ')}
              </p>
            )}
            {r.cafe.phone && <p className="text-[12px] text-muted-foreground">{r.cafe.phone}</p>}
            {/* Only meaningful for a registered café — never shown otherwise. */}
            {r.cafe.gst_registered && r.cafe.gstin && (
              <p className="text-[12px] text-muted-foreground">GSTIN: {r.cafe.gstin}</p>
            )}
            <p className="mt-2.5 inline-block rounded-full bg-surface-subtle px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
              {r.gst_invoice ? 'Tax Invoice' : 'Bill'}
            </p>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border py-3 text-[12.5px] text-muted-foreground">
            <span>Bill No. <span className="font-medium text-foreground">{billNumber}</span></span>
            <span>{when}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border py-3 text-[12.5px]">
            <span className="rounded-full border border-border-strong px-2.5 py-1 font-medium uppercase tracking-wide text-foreground">
              {r.order.order_type === 'takeaway' ? 'Takeaway' : r.order.table_label ? `Table ${r.order.table_label}` : 'Dine-in'}
            </span>
            {r.order.order_type !== 'takeaway' && <span className="text-muted-foreground">Dine-in</span>}
          </div>
          {r.gst_invoice && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border py-2.5 text-[12px] text-muted-foreground">
              <span>Place of supply: {r.gst_invoice.place_of_supply}</span>
            </div>
          )}

          {/* ── Customer info — deliberately smaller/quieter than the bill
              itself, and only the details already surfaced elsewhere in the
              app (masked phone, first name) — nothing extra collected here. */}
          {(r.order.customer_name || r.order.phone_masked) && (
            <p className="border-b border-border py-2.5 text-[12px] text-muted-foreground">
              {[r.order.customer_name, r.order.phone_masked].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* ── Items ─────────────────────────────────────────────────── */}
          <div className="pt-1">
            <div className="flex justify-between gap-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Item</span>
              <span className="flex gap-4">
                <span className="w-8 text-right">Qty</span>
                <span className="w-16 text-right">Total</span>
              </span>
            </div>
            <ul className="divide-y divide-border">
              {r.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-3 py-2.5 text-[13.5px]">
                  <div className="min-w-0">
                    {/* First component of a combo carries the bundle heading, so
                        the guest reads "Meal for Two" rather than a loose list of
                        items they didn't order individually. Components keep
                        their real prices so the subtotal still adds up and the
                        saving shows on the Discount line. */}
                    {it.combo_group && it.combo_group !== r.items[i - 1]?.combo_group && (
                      <p className="mb-0.5 text-[12px] font-medium text-primary">
                        {it.combo_name ?? 'Combo'}{it.combo_price != null ? ` · ₹${it.combo_price}` : ''}
                      </p>
                    )}
                    <p className={it.combo_group ? 'pl-2.5 font-medium text-foreground' : 'font-medium text-foreground'}>{it.name}</p>
                    {it.modifiers?.length > 0 && (
                      <p className={`${it.combo_group ? 'pl-2.5' : ''} text-[11.5px] text-muted-foreground`}>
                        {it.modifiers.map((m) => `+ ${m.name}`).join('  ')}
                      </p>
                    )}
                    {r.gst_invoice && (
                      <p className={`${it.combo_group ? 'pl-2.5' : ''} text-[10.5px] text-muted-foreground`}>
                        {[
                          it.hsn_sac ? `HSN/SAC ${it.hsn_sac}` : null,
                          it.tax_percent != null ? `GST ${it.tax_percent}%` : null,
                          it.taxable_value != null ? `taxable ₹${it.taxable_value}` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 gap-4 tabular-nums">
                    <span className="w-8 text-right text-muted-foreground">{it.qty}</span>
                    <span className="w-16 text-right font-medium text-foreground">₹{it.price * it.qty}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Summary ───────────────────────────────────────────────── */}
          <div className="space-y-1.5 border-t border-border pt-3 text-[13.5px]">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span><span className="tabular-nums">₹{r.order.subtotal}</span>
            </div>
            {r.order.discount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount{r.order.coupon_code ? ` (${r.order.coupon_code})` : ''}</span>
                <span className="tabular-nums text-success">−₹{r.order.discount}</span>
              </div>
            )}
            {r.gst_invoice && (
              <div className="flex justify-between text-muted-foreground">
                <span>Taxable amount</span><span className="tabular-nums">₹{r.gst_invoice.taxable_amount}</span>
              </div>
            )}
            {r.order.tax > 0 && r.gst_invoice ? (
              <>
                <div className="flex justify-between text-muted-foreground"><span>CGST</span><span className="tabular-nums">₹{r.gst_invoice.cgst}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>SGST</span><span className="tabular-nums">₹{r.gst_invoice.sgst}</span></div>
                {r.cafe.tax_inclusive && (
                  <p className="text-[11px] text-muted-foreground">(GST included in the prices above)</p>
                )}
              </>
            ) : r.order.tax > 0 ? (
              <div className="flex justify-between text-muted-foreground"><span>Tax</span><span className="tabular-nums">₹{r.order.tax}</span></div>
            ) : null}
            {r.order.service_charge > 0 && (
              <div className="flex justify-between text-muted-foreground"><span>Service charge</span><span className="tabular-nums">₹{r.order.service_charge}</span></div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-2.5 text-foreground">
              <span className="text-[13.5px] font-semibold">Total</span>
              <span className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)' }}>₹{r.order.total}</span>
            </div>
          </div>

          {/* ── Payment section ───────────────────────────────────────── */}
          <div className="mt-4 rounded-xl border border-border bg-surface-subtle p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payment status</span>
              <span className={`text-[12.5px] font-bold uppercase tracking-wide ${
                state === 'paid' ? 'text-success' : state === 'partial' ? 'text-warning' : state === 'refunded' ? 'text-muted-foreground' : 'text-destructive'
              }`}>
                {stateLabel}
              </span>
            </div>

            {state === 'paid' && shownPayment && (
              <div className="mt-2.5 space-y-1 text-[12.5px] text-muted-foreground">
                <p className="flex items-center gap-1.5 text-success"><span aria-hidden="true">✓</span> Payment successful</p>
                <p>Payment method: <span className="font-medium text-foreground">{methodLabel(shownPayment.method)}</span></p>
                {shownPayment.reference && <p>Transaction ID: <span className="font-medium text-foreground">{shownPayment.reference}</span></p>}
                <p>Paid on {formatDateTime(shownPayment.created_at, tz)}</p>
              </div>
            )}

            {state === 'partial' && (
              <div className="mt-2.5 space-y-1 text-[12.5px] text-muted-foreground">
                <p>Paid so far: <span className="font-medium text-foreground">₹{paidSoFar}</span></p>
                <div className="mt-1.5 flex items-baseline justify-between rounded-lg bg-warning-subtle px-3 py-2">
                  <span className="text-[12px] font-medium text-warning">Amount due</span>
                  <span className="text-lg font-bold tabular-nums text-warning">₹{due}</span>
                </div>
              </div>
            )}

            {(state === 'unpaid' || state === 'failed') && (
              <div className="mt-2.5 space-y-1 text-[12.5px] text-muted-foreground">
                {state === 'failed' && <p className="text-destructive">The last payment attempt didn&apos;t go through.</p>}
                <div className="mt-1.5 flex items-baseline justify-between rounded-lg bg-destructive-subtle px-3 py-2">
                  <span className="text-[12px] font-medium text-destructive">Amount due</span>
                  <span className="text-lg font-bold tabular-nums text-destructive">₹{due}</span>
                </div>
                <p className="pt-0.5">Please settle this with the café directly.</p>
              </div>
            )}

            {state === 'refunded' && (
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">This bill has been refunded — see any credit note below for the amount and reason.</p>
            )}
          </div>

          {creditNotes.length > 0 && (
            <div className="mt-3 space-y-2">
              {creditNotes.map((cn, i) => (
                <div key={i} className="rounded-xl border border-border bg-surface-subtle p-3 text-[12px] text-muted-foreground">
                  <p className="font-medium text-foreground">Credit note {cn.credit_note_number}</p>
                  <p>{formatDateTime(cn.issued_at, tz)} · ₹{cn.amount}{cn.reason ? ` · ${cn.reason}` : ''}</p>
                </div>
              ))}
            </div>
          )}

          <ReceiptDownloadButton receipt={r} />

          <p className="mt-5 border-t border-border pt-4 text-center text-[12px] text-muted-foreground">
            Thank you for visiting!
            <span className="mt-0.5 block text-[10.5px] text-muted-foreground/70">Powered by KhaoPiyo</span>
          </p>
        </div>
      </div>

      {/* The bill is where a guest who paid cash at the counter comes back to,
          so the wheel lives here too — the confirmation screen is still
          showing "unpaid" at the moment they hand over the money. Hides itself
          unless this café runs a wheel and the bill is settled. */}
      <div className="mt-6 print:hidden">
        <SpinWheel receiptToken={token} />
      </div>

      <div className="print:hidden">
        <FeedbackForm token={token} googleReviewUrl={r.cafe.google_review_url} />
      </div>
    </main>
  )
}
