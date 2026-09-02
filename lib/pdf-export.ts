// Client-side PDF generation for bills/receipts (browser download, no server
// route) — same "build a buffer, trigger <a download>" pattern already used
// by lib/xlsx-export.ts for Excel reports.
//
// jsPDF's built-in fonts (helvetica/times/courier) are the 14 standard PDF
// fonts, encoded WinAnsi — they have no ₹ glyph (confirmed: writing "₹500"
// renders as "¹500", not a missing-glyph box, so it fails silently rather
// than loudly). Embedding a Unicode font just for the ₹ sign isn't worth the
// bundle weight, so amounts print as "Rs 500" here, unlike the on-screen
// receipt which uses ₹ freely in HTML.
import jsPDF from 'jspdf'
import { formatDateTime, DEFAULT_TIMEZONE } from '@/lib/datetime'
import { resolvePaymentState, RECEIPT_STATE_LABEL, methodLabel } from '@/lib/receipt-status'

export type ReceiptData = {
  cafe: {
    name: string; legal_name: string | null; trade_name: string | null
    address: string | null; city: string | null; state: string | null; pincode: string | null
    gstin: string | null; logo_url: string | null; phone: string | null
    gst_registered: boolean; tax_inclusive: boolean; timezone: string | null
    bill_link_url: string | null
    bill_link_label: string | null
  }
  order: {
    short_code: string; created_at: string; order_type: string
    payment_status: string; payment_method: string | null
    subtotal: number; discount: number; tax: number; service_charge: number; total: number
    coupon_code: string | null; table_label: string | null; phone_masked: string | null
    customer_name: string | null
    /** Who rang the bill up — profiles.full_name via orders.staff_id (0209). */
    staff_name?: string | null
    /**
     * The unmasked number, and ONLY present when the caller is an active member
     * of the café — /r/<token> is a public link that gets forwarded, so a guest
     * (and anyone they forward to) still gets phone_masked and nothing more.
     * See migration 0209.
     */
    phone_full?: string | null
    notes?: string | null
  }
  /** Every payments row for this order, oldest first — a paid order can have
   * more than one (a split payment across methods). */
  payments: {
    method: string; amount: number; reference: string | null
    status: string; provider: string | null; created_at: string
  }[]
  gst_invoice: {
    invoice_number: string; issued_at: string; taxable_amount: number
    cgst: number; sgst: number; place_of_supply: string
  } | null
  credit_notes: {
    credit_note_number: string; issued_at: string; amount: number
    taxable_value: number; tax_amount: number; cgst: number; sgst: number; reason: string | null
  }[]
  items: {
    name: string; qty: number; price: number; modifiers: { name: string; price: number }[]
    hsn_sac: string | null; tax_percent: number | null; taxable_value: number | null; tax_amount: number | null
    // Set on components of a combo (migration 0123) so a receipt can group
    // them under the bundle they were ordered as.
    combo_group?: string | null; combo_name?: string | null; combo_price?: number | null
  }[]
}

const MARGIN = 16
const PAGE_W = 210
const PAGE_H = 297
const WIDTH = PAGE_W - MARGIN * 2
const BOTTOM = PAGE_H - 16

const BRAND: [number, number, number] = [194, 65, 12] // app/globals.css --primary
const GREY: [number, number, number] = [107, 114, 128]
const INK: [number, number, number] = [23, 23, 23]
const LINE: [number, number, number] = [229, 224, 220]
const GREEN: [number, number, number] = [22, 163, 74] // --success
const AMBER: [number, number, number] = [161, 98, 7] // --warning
const RED: [number, number, number] = [185, 28, 28] // --destructive

const STAMP_COLOR: Record<string, [number, number, number]> = {
  paid: GREEN, partial: AMBER, failed: RED, unpaid: RED, refunded: GREY,
}

const money = (n: number) => `Rs ${(n ?? 0).toLocaleString('en-IN')}`

function hr(doc: jsPDF, y: number): void {
  doc.setDrawColor(...LINE)
  doc.line(MARGIN, y, MARGIN + WIDTH, y)
}

// Long item lists can overflow one page — start a fresh page rather than run
// text off the bottom edge.
function ensureRoom(doc: jsPDF, y: number, need: number): number {
  if (y + need <= BOTTOM) return y
  doc.addPage()
  return MARGIN
}

// Rotated, translucent status stamp, drawn first so every later doc.text()
// call paints fully opaque on top of it — the only way jsPDF layers "behind
// readable content" is paint order, there is no real z-index.
function drawStamp(doc: jsPDF, state: string): void {
  const cx = MARGIN + WIDTH / 2
  const cy = PAGE_H / 2
  doc.saveGraphicsState()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc.setGState(new (doc as any).GState({ opacity: 0.16 }))
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(46)
  doc.setTextColor(...(STAMP_COLOR[state] ?? RED))
  doc.text(RECEIPT_STATE_LABEL[state as keyof typeof RECEIPT_STATE_LABEL] ?? 'UNPAID', cx, cy, { align: 'center', angle: 20 })
  doc.restoreGraphicsState()
}

function drawReceipt(doc: jsPDF, r: ReceiptData): void {
  const tz = r.cafe.timezone ?? DEFAULT_TIMEZONE
  const when = formatDateTime(r.order.created_at, tz)
  // Defensive against get_receipt not having shipped the payments field yet
  // (migration 0160) wherever this runs — never crash a bill export.
  const payments = r.payments ?? []
  const state = resolvePaymentState(r.order.payment_status, payments)
  drawStamp(doc, state)
  const cx = MARGIN + WIDTH / 2
  let y = MARGIN + 6

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK)
  doc.text(r.cafe.name, cx, y, { align: 'center' })
  y += 6.5

  if (r.cafe.gst_registered && r.cafe.legal_name && r.cafe.legal_name !== r.cafe.name) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
    doc.text(r.cafe.legal_name, cx, y, { align: 'center' })
    y += 5
  }
  const addrLine = [r.cafe.address, r.cafe.city, r.cafe.state, r.cafe.pincode].filter(Boolean).join(', ')
  if (addrLine) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
    const lines = doc.splitTextToSize(addrLine, WIDTH - 20)
    doc.text(lines, cx, y, { align: 'center' })
    y += lines.length * 4.3
  }
  if (r.cafe.gst_registered && r.cafe.gstin) {
    doc.setFontSize(9); doc.setTextColor(...GREY)
    doc.text(`GSTIN: ${r.cafe.gstin}`, cx, y, { align: 'center' })
    y += 5
  }
  y += 1
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...BRAND)
  doc.text(r.gst_invoice ? 'TAX INVOICE' : 'RECEIPT', cx, y, { align: 'center' })
  y += 5
  hr(doc, y); y += 6

  if (r.gst_invoice) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK)
    doc.text(`Invoice: ${r.gst_invoice.invoice_number}`, MARGIN, y)
    doc.text(`Place of supply: ${r.gst_invoice.place_of_supply}`, MARGIN + WIDTH, y, { align: 'right' })
    y += 6
    hr(doc, y); y += 6
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
  doc.text(`Order #${r.order.short_code}`, MARGIN, y)
  const typeLabel = r.order.order_type === 'takeaway'
    ? 'Takeaway'
    : `Dine-in${r.order.table_label ? ' - Table ' + r.order.table_label : ''}`
  doc.text(typeLabel, cx, y, { align: 'center' })
  doc.text(when, MARGIN + WIDTH, y, { align: 'right' })
  y += 6

  // phone_full is present only for a café member (migration 0209); a guest
  // downloading their own copy still gets the mask, same as the page.
  const phoneShown = r.order.phone_full ?? r.order.phone_masked
  if (r.order.customer_name || phoneShown) {
    doc.text([r.order.customer_name, phoneShown].filter(Boolean).join(' · '), MARGIN, y)
    y += 6
  }
  if (r.order.staff_name) {
    doc.text(`Served by ${r.order.staff_name}`, MARGIN, y)
    y += 6
  }
  if (r.order.notes) {
    // Wrapped, not truncated — a note is usually the reason a bill looks odd.
    const noteLines = doc.splitTextToSize(`Note: ${r.order.notes}`, WIDTH)
    doc.text(noteLines, MARGIN, y)
    y += noteLines.length * 4.6 + 1.5
  }
  hr(doc, y); y += 7

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
  doc.text('ITEM', MARGIN, y)
  doc.text('AMOUNT', MARGIN + WIDTH, y, { align: 'right' })
  y += 5
  hr(doc, y); y += 5.5

  for (const it of r.items) {
    y = ensureRoom(doc, y, 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK)
    doc.text(`${it.qty} x ${it.name}`, MARGIN, y)
    doc.text(money(it.price * it.qty), MARGIN + WIDTH, y, { align: 'right' })
    y += 5

    if (it.modifiers?.length > 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
      doc.text(it.modifiers.map((m) => m.name).join(', '), MARGIN + 3, y)
      y += 4.3
    }
    if (r.gst_invoice) {
      const bits = [
        it.hsn_sac ? `HSN/SAC ${it.hsn_sac}` : null,
        it.tax_percent != null ? `GST ${it.tax_percent}%` : null,
        it.taxable_value != null ? `taxable ${money(it.taxable_value)}` : null,
      ].filter(Boolean).join(' . ')
      if (bits) {
        doc.setFontSize(7.5); doc.setTextColor(...GREY)
        doc.text(bits, MARGIN + 3, y)
        y += 4
      }
    }
    y += 1.5
  }

  y = ensureRoom(doc, y, 45)
  hr(doc, y); y += 7

  const row = (label: string, value: string, opts?: { bold?: boolean; size?: number; color?: [number, number, number] }) => {
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
    doc.setFontSize(opts?.size ?? 10)
    doc.setTextColor(...(opts?.color ?? (opts?.bold ? INK : GREY)))
    doc.text(label, MARGIN, y)
    doc.text(value, MARGIN + WIDTH, y, { align: 'right' })
    y += opts?.bold ? 7 : 5.5
  }

  row('Subtotal', money(r.order.subtotal))
  if (r.order.discount > 0) {
    row(`Discount${r.order.coupon_code ? ` (${r.order.coupon_code})` : ''}`, `-${money(r.order.discount)}`)
  }
  if (r.gst_invoice) {
    row('Taxable amount', money(r.gst_invoice.taxable_amount))
    row('CGST', money(r.gst_invoice.cgst))
    row('SGST', money(r.gst_invoice.sgst))
  } else if (r.order.tax > 0) {
    row('Tax', money(r.order.tax))
  }
  if (r.order.service_charge > 0) row('Service charge', money(r.order.service_charge))

  hr(doc, y - 3.5)
  row('TOTAL', money(r.order.total), { bold: true, size: 12.5 })

  const captured = payments.filter((p) => p.status === 'captured')
  const shownPayment = captured[captured.length - 1] ?? payments[payments.length - 1] ?? null
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY)
  doc.text(methodLabel(shownPayment?.method ?? r.order.payment_method), MARGIN, y)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...(STAMP_COLOR[state] ?? RED))
  doc.text(RECEIPT_STATE_LABEL[state], MARGIN + WIDTH, y, { align: 'right' })
  y += 6

  if (state === 'paid' || state === 'partial') {
    const paidSoFar = captured.reduce((s, p) => s + p.amount, 0)
    const due = Math.max(0, r.order.total - paidSoFar)
    if (due > 0) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...(state === 'partial' ? AMBER : RED))
      doc.text('Amount due', MARGIN, y)
      doc.text(money(due), MARGIN + WIDTH, y, { align: 'right' })
      y += 6
    }
  }
  if (shownPayment?.reference) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GREY)
    doc.text(`Transaction ID: ${shownPayment.reference}`, MARGIN, y)
    y += 5
  }
  y += 4

  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
  doc.text('Thank you for visiting!', cx, y, { align: 'center' })
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cafe'

// These return the filename rather than void so the caller can say where the
// file went. It matters most in the desktop app, which has no download bar:
// the webview saves the file and shows nothing at all, so without a toast the
// café taps Download, sees nothing happen, and reasonably concludes it failed.

/** Single receipt — the customer's own "Download" button on /r/[token]. */
export function downloadReceiptPdf(r: ReceiptData): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  drawReceipt(doc, r)
  const file = `${slug(r.cafe.name)}-bill-${r.order.short_code}.pdf`
  doc.save(file)
  return file
}

/** One consolidated multi-page PDF — the owner's date-range bulk export. */
export function downloadBulkReceiptsPdf(receipts: ReceiptData[], meta: { cafeName: string; fromISO: string; toISO: string }): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  receipts.forEach((r, i) => {
    if (i > 0) doc.addPage()
    drawReceipt(doc, r)
  })
  const day = (iso: string) => iso.slice(0, 10)
  const file = `${slug(meta.cafeName)}-bills-${day(meta.fromISO)}-to-${day(meta.toISO)}.pdf`
  doc.save(file)
  return file
}
