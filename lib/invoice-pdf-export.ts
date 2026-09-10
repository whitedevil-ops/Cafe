// Client-side PDF for a manually-generated KhaoPiyo subscription invoice —
// same pattern as lib/pdf-export.ts (a café's own customer-facing bill PDF):
// build a jsPDF doc, `doc.save()` triggers the browser's own download. Kept
// as its own file rather than added to pdf-export.ts because the two are
// genuinely different documents (Ventron billing a café for KhaoPiyo, vs. a
// café billing its own customer for an order) that only happen to share a
// PDF library and a page size.
import jsPDF from 'jspdf'

export type PlatformInvoice = {
  invoice_number: string
  created_at: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  billing_address: string | null
  billing_city: string | null
  billing_state: string | null
  billing_pincode: string | null
  billing_country: string
  gstin: string | null
  plan_name: string
  subscription_start: string | null
  subscription_end: string | null
  amount: number
  discount: number
  tax: number
  grand_total: number
  payment_method: string | null
  payment_date: string | null
  payment_reference: string | null
  payment_status: string
}

const MARGIN = 16
const PAGE_W = 210
const WIDTH = PAGE_W - MARGIN * 2

// Same palette as lib/pdf-export.ts (app/globals.css --primary etc.) — one
// KhaoPiyo-issued PDF should look like it came from the same place as another.
const BRAND: [number, number, number] = [194, 65, 12]
const GREY: [number, number, number] = [107, 114, 128]
const INK: [number, number, number] = [23, 23, 23]
const LINE: [number, number, number] = [229, 224, 220]
const GREEN: [number, number, number] = [22, 163, 74]
const AMBER: [number, number, number] = [161, 98, 7]
const RED: [number, number, number] = [185, 28, 28]

const STATUS_COLOR: Record<string, [number, number, number]> = {
  paid: GREEN, partial: AMBER, pending: AMBER, failed: RED,
}
const STATUS_LABEL: Record<string, string> = {
  paid: 'PAID', partial: 'PARTIALLY PAID', pending: 'PAYMENT PENDING', failed: 'PAYMENT FAILED',
}

// jsPDF's standard fonts have no ₹ glyph (see lib/pdf-export.ts's own note —
// confirmed there, reused here rather than re-verified) — same "Rs" fallback.
const money = (n: number) => `Rs ${(n ?? 0).toLocaleString('en-IN')}`
const dateStr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

function hr(doc: jsPDF, y: number): void {
  doc.setDrawColor(...LINE)
  doc.line(MARGIN, y, MARGIN + WIDTH, y)
}

function drawInvoice(doc: jsPDF, inv: PlatformInvoice): void {
  let y = MARGIN + 4

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...INK)
  doc.text('VENTRON', MARGIN, y)
  doc.setFontSize(10); doc.setTextColor(...BRAND)
  doc.text('KhaoPiyo', MARGIN, y + 5.5)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
  doc.text('Product: KhaoPiyo', MARGIN + WIDTH, y - 1, { align: 'right' })
  doc.text('Website: https://khaopiyo.ventron.in', MARGIN + WIDTH, y + 4, { align: 'right' })
  y += 13
  hr(doc, y); y += 8

  // Invoice number / date, and the payment-status stamp beside them — this
  // is the one figure an admin re-checking a printed/downloaded copy needs
  // to see without reading the whole page.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
  doc.text(inv.invoice_number, MARGIN, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
  doc.text(`Invoice date: ${dateStr(inv.created_at)}`, MARGIN, y + 5.5)

  const statusColor = STATUS_COLOR[inv.payment_status] ?? GREY
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...statusColor)
  doc.text(STATUS_LABEL[inv.payment_status] ?? inv.payment_status.toUpperCase(), MARGIN + WIDTH, y, { align: 'right' })
  y += 12
  hr(doc, y); y += 8

  // Bill To
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
  doc.text('BILL TO', MARGIN, y)
  y += 5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK)
  doc.text(inv.customer_name, MARGIN, y)
  y += 5.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
  const addrLine = [inv.billing_address, inv.billing_city, inv.billing_state, inv.billing_pincode, inv.billing_country]
    .filter(Boolean).join(', ')
  if (addrLine) {
    const lines = doc.splitTextToSize(addrLine, WIDTH * 0.65)
    doc.text(lines, MARGIN, y)
    y += lines.length * 4.3
  }
  if (inv.customer_phone) { doc.text(`Phone: ${inv.customer_phone}`, MARGIN, y); y += 4.3 }
  if (inv.customer_email) { doc.text(`Email: ${inv.customer_email}`, MARGIN, y); y += 4.3 }
  if (inv.gstin) { doc.text(`GSTIN: ${inv.gstin}`, MARGIN, y); y += 4.3 }
  y += 4
  hr(doc, y); y += 8

  // Plan / subscription period
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
  doc.text('PLAN', MARGIN, y)
  doc.text('SUBSCRIPTION PERIOD', MARGIN + WIDTH, y, { align: 'right' })
  y += 5.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...INK)
  doc.text(inv.plan_name, MARGIN, y)
  doc.setFontSize(9.5)
  doc.text(`${dateStr(inv.subscription_start)} — ${dateStr(inv.subscription_end)}`, MARGIN + WIDTH, y, { align: 'right' })
  y += 10
  hr(doc, y); y += 8

  // Amount breakdown
  const row = (label: string, value: string, opts?: { bold?: boolean; size?: number }) => {
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
    doc.setFontSize(opts?.size ?? 10)
    doc.setTextColor(...(opts?.bold ? INK : GREY))
    doc.text(label, MARGIN, y)
    doc.text(value, MARGIN + WIDTH, y, { align: 'right' })
    y += opts?.bold ? 7 : 5.5
  }
  row('Amount', money(inv.amount))
  if (inv.discount > 0) row('Discount', `-${money(inv.discount)}`)
  if (inv.tax > 0) row('GST / Tax', money(inv.tax))
  hr(doc, y - 3.5)
  row('GRAND TOTAL', money(inv.grand_total), { bold: true, size: 13 })
  y += 3
  hr(doc, y); y += 8

  // Payment details
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
  doc.text('PAYMENT', MARGIN, y)
  y += 5.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK)
  doc.text(`Method: ${inv.payment_method ?? '—'}`, MARGIN, y)
  doc.text(`Date: ${dateStr(inv.payment_date)}`, MARGIN + WIDTH, y, { align: 'right' })
  y += 5.5
  if (inv.payment_reference) {
    doc.setFontSize(9); doc.setTextColor(...GREY)
    doc.text(`Reference / UPI transaction ID: ${inv.payment_reference}`, MARGIN, y)
    y += 5.5
  }
  y += 6

  // Required non-refundable clause — placed near the bottom of the page
  // regardless of how much content precedes it, not squeezed against
  // whatever happens to be the last row above.
  const footY = 268
  hr(doc, footY - 6)
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...GREY)
  const clause = doc.splitTextToSize(
    'Payments are non-refundable, subject to applicable law and the applicable Terms & Conditions.',
    WIDTH,
  )
  doc.text(clause, MARGIN, footY)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  doc.text('This is a system-generated invoice issued by Ventron for KhaoPiyo.', MARGIN, footY + clause.length * 4 + 4)
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'invoice'

/** Returns the filename it saved, matching lib/pdf-export.ts's own convention
 *  (see its header comment — the desktop app's webview has no download bar,
 *  so the caller needs the name to confirm anything happened at all). */
export function downloadPlatformInvoicePdf(inv: PlatformInvoice): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  drawInvoice(doc, inv)
  const file = `${inv.invoice_number}-${slug(inv.customer_name)}.pdf`
  doc.save(file)
  return file
}
