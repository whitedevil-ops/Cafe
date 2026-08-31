import { formatDayMonth, formatTime, DEFAULT_TIMEZONE } from '@/lib/datetime'

// Kitchen ticket, rendered as HTML for the browser's own print path.
//
// Why HTML and not ESC/POS: a browser cannot open a socket or a serial port to
// a printer, so the only printing it can do is through the OS print dialog
// against an installed driver. That makes the printer's own brand irrelevant —
// anything Windows can print to, this can print to, including a Bluetooth
// printer paired at the OS level. The trade is that layout is CSS rather than
// printer commands, so the width has to be right and the type has to be big
// enough to read at arm's length in a hot kitchen.
//
// Kept as a pure string builder, separate from anything that touches the DOM,
// so the layout rules can be tested without a browser. Mirrors the ESC/POS
// layout in desktop/src-tauri/src/escpos.rs — same hierarchy, same content,
// different rendering technology.

export type KotItem = {
  qty: number
  name: string
  modifiers?: string[]
  note?: string | null
}

export type KotTicket = {
  /** Short order code. */
  kotNumber: string
  /** The café's own name — printed in the footer. Never the platform's. */
  cafeName?: string | null
  tableLabel?: string | null
  orderType?: string | null
  /** ISO timestamp; formatted in the café's zone, never the machine's. */
  placedAt: string
  timezone?: string
  station?: string | null
  paperWidth?: '58mm' | '80mm'
  items: KotItem[]
  orderNote?: string | null
  /** qr | pos | waiter | ... — shown small in the footer, not the headline. */
  source?: string | null
  /** Identical tickets to emit, e.g. one for the pass and one for the line. */
  copies?: number
}

/** A change-KOT: a delta against whatever was already sent to this printer
 * for this order, not a full re-ticket. Kept as a visually distinct layout
 * (a bordered "KOT UPDATE" header) so it can never be mistaken for a new
 * order at a glance. */
export type KotUpdateTicket = {
  kotNumber: string
  cafeName?: string | null
  tableLabel?: string | null
  orderType?: string | null
  placedAt: string
  timezone?: string
  station?: string | null
  paperWidth?: '58mm' | '80mm'
  added: KotItem[]
  removed: KotItem[]
  orderNote?: string | null
  source?: string | null
  copies?: number
}

/**
 * Item names, modifiers and notes are café- and guest-supplied, and this
 * string is injected as markup. Escape everything.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 58mm rolls print about 48mm wide; 80mm about 72mm. */
const CONTENT_MM = { '58mm': 48, '80mm': 72 } as const

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: 'DINE-IN',
  takeaway: 'TAKEAWAY',
  delivery: 'DELIVERY',
}

function orderTypeLabel(orderType?: string | null): string {
  return ORDER_TYPE_LABEL[orderType ?? ''] ?? 'DINE-IN'
}

/** The single biggest thing on the ticket — what a cook reads from across
 * the kitchen. A table number for dine-in, or the order type itself when
 * there's no table to show (spec: never show irrelevant table info). */
function heroLabel(t: { orderType?: string | null; tableLabel?: string | null }): string {
  if (t.orderType === 'takeaway') return 'TAKEAWAY'
  if (t.orderType === 'delivery') return 'DELIVERY'
  return t.tableLabel ? `TABLE ${esc(t.tableLabel.toUpperCase())}` : 'DINE-IN'
}

function metaLine(placedAt: string, timezone: string | undefined): string {
  const tz = timezone || DEFAULT_TIMEZONE
  return `${esc(formatDayMonth(placedAt, tz))} &bull; ${esc(formatTime(placedAt, tz))}`
}

const SOURCE_LABEL: Record<string, string> = { qr: 'QR', pos: 'POS', waiter: 'WAITER' }

function footerLine(placedAt: string, timezone: string | undefined, source?: string | null, cafeName?: string | null): string {
  const parts = [esc(cafeName ?? ''), metaLine(placedAt, timezone)].filter(Boolean)
  const src = source ? SOURCE_LABEL[source] ?? source.toUpperCase() : null
  if (src) parts.push(esc(src))
  return parts.join(' &bull; ')
}

/** One item line, optionally marked with a +/- delta prefix for a change-KOT. */
function itemLine(i: KotItem, marker?: '+' | '-'): string {
  const mods = (i.modifiers ?? []).filter(Boolean)
  const markerCls = marker === '+' ? ' add' : marker === '-' ? ' rm' : ''
  return [
    `<div class="item${markerCls}">`,
    `<div class="line"><span class="qty">${marker ? esc(marker) + ' ' : ''}${i.qty}&times;</span><span class="nm">${esc(i.name)}</span></div>`,
    // Bullet rather than "+" for modifiers — "+" is now the update-ticket's
    // own added-item marker, and reusing it here read as two unrelated
    // meanings sharing one symbol.
    mods.length ? `<div class="mod">${mods.map((m) => `&bull; ${esc(m)}`).join('<br/>')}</div>` : '',
    i.note ? `<div class="note">NOTE: ${esc(i.note.toUpperCase())}</div>` : '',
    '</div>',
  ].join('')
}

function noteBox(orderNote?: string | null): string {
  if (!orderNote) return ''
  return `<div class="rule"></div><div class="notebox"><div class="notehead">&#9733; KITCHEN NOTE</div><div class="notebody">${esc(orderNote.toUpperCase())}</div></div>`
}

/** Order#/station on one line, date/time on the next — was four stacked
 * one-per-line paragraphs, which read as filler rather than information. */
function subLine(kotNumber: string, station?: string | null): string {
  return [
    '<div class="subline">',
    `<span class="ordno">#${esc(kotNumber)}</span>`,
    station ? `<span class="station">${esc(station.toUpperCase())}</span>` : '',
    '</div>',
  ].join('')
}

function ticketBody(t: KotTicket): string {
  const items = t.items.map((i) => itemLine(i)).join('')

  return [
    '<div class="kot">',
    // The one splash of branded identity a thermal ticket can carry —
    // everything below stays plain black-on-white for legibility across a
    // hot kitchen, but this reversed bar is what stops it reading as a
    // generic till-roll printout.
    t.cafeName ? `<div class="brandbar">${esc(t.cafeName)}</div>` : '',
    `<div class="otype">${esc(orderTypeLabel(t.orderType))}</div>`,
    `<div class="hero">${heroLabel(t)}</div>`,
    subLine(t.kotNumber, t.station),
    `<div class="meta">${metaLine(t.placedAt, t.timezone)}</div>`,
    '<div class="rule"></div>',
    items,
    noteBox(t.orderNote),
    '<div class="rule solid"></div>',
    `<div class="footer">${footerLine(t.placedAt, t.timezone, t.source, t.cafeName)}</div>`,
    '<div class="tail"></div>',
    '</div>',
  ].join('')
}

function updateTicketBody(t: KotUpdateTicket): string {
  const added = t.added.map((i) => itemLine(i, '+')).join('')
  const removed = t.removed.map((i) => itemLine(i, '-')).join('')

  return [
    '<div class="kot upd">',
    t.cafeName ? `<div class="brandbar">${esc(t.cafeName)}</div>` : '',
    '<div class="updhead">KOT UPDATE</div>',
    `<div class="hero">${heroLabel(t)}</div>`,
    subLine(t.kotNumber, t.station),
    `<div class="meta">${metaLine(t.placedAt, t.timezone)}</div>`,
    '<div class="rule"></div>',
    added,
    removed,
    noteBox(t.orderNote),
    '<div class="rule solid"></div>',
    `<div class="footer">${footerLine(t.placedAt, t.timezone, t.source, t.cafeName)}</div>`,
    '<div class="tail"></div>',
    '</div>',
  ].join('')
}

const TICKET_CSS = (width: '58mm' | '80mm', mm: number) => `
  /* Roll paper is continuous: fixing the height would pad every ticket out to
     a page and waste most of it, so the height is auto and the margin is the
     printer's own. */
  @page { size: ${width} auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body {
    width: ${mm}mm; margin: 0; padding: 0;
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #000; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .kot { padding-bottom: 2mm; }
  /* Each copy after the first starts its own sheet so the cutter has a seam. */
  .kot + .kot { page-break-before: always; }
  /* The one piece of branded identity a thermal ticket can carry. Full-bleed
     reversed bar, not another line of body text, so the ticket reads as
     "from this café" before a cook reads a single word of the order. */
  .brandbar {
    background: #000; color: #fff; margin: 0 0 2.5mm; padding: 1.6mm 0;
    font-size: 12px; font-weight: 800; letter-spacing: 1.5px; text-align: center;
    text-transform: uppercase;
  }
  .otype { font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #555; }
  /* The single biggest thing on the ticket — read from across the kitchen. */
  .hero { font-size: 32px; font-weight: 900; line-height: 1.05; letter-spacing: -0.5px; margin-top: 0.5mm; }
  /* Order # and station share a row instead of each getting its own stacked
     line — four one-line paragraphs in a row read as padding, not content. */
  .subline { display: flex; justify-content: space-between; align-items: center; margin-top: 1.5mm; }
  .ordno { font-size: 13px; font-weight: 700; }
  .station { font-size: 10.5px; font-weight: 800; letter-spacing: 0.5px; background: #000; color: #fff; padding: 0.6mm 1.8mm; }
  .meta { font-size: 10.5px; color: #555; margin-top: 0.5mm; }
  .rule { border-top: 1px dashed #000; margin: 2.5mm 0; }
  /* A solid rule reads as a real section break; dashed is for "more of the
     same list continues" — the footer is neither, so it gets the heavier one. */
  .rule.solid { border-top: 1.5px solid #000; }
  /* A hairline between items instead of relying on margin alone — the list
     was legible before but had no actual structure separating one dish from
     the next, which is a lot of what read as "cheap". */
  .item { margin-bottom: 2.5mm; padding-bottom: 2.5mm; border-bottom: 1px dotted #bbb; }
  .item:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: 0; }
  /* The cook reads this across a pass, so quantity and name are the largest
     things after the hero line, and never wrap into an indistinct block. */
  .line { display: flex; gap: 2mm; align-items: center; }
  /* Boxed rather than bare bold text — a ticket-stub qty marker reads as
     deliberately designed, not just "big number, hope it stands out". */
  .qty {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 8mm; font-size: 15px; font-weight: 900;
    border: 1.4px solid #000; padding: 0.4mm 1.2mm;
  }
  .nm { flex: 1; font-size: 18px; font-weight: 700; line-height: 1.2; word-break: break-word; }
  .mod { font-size: 11.5px; padding-left: 10mm; line-height: 1.45; color: #333; }
  .note { font-size: 11.5px; font-weight: 700; padding-left: 10mm; margin-top: 0.5mm; }
  .item.add .qty, .item.add .nm { color: #14532d; }
  .item.add .qty { border-color: #14532d; }
  .item.rm .qty, .item.rm .nm { color: #7f1d1d; text-decoration: line-through; }
  .item.rm .qty { border-color: #7f1d1d; }
  /* A kitchen note is the one thing that must never blend into the rest of
     the ticket — a bordered box with a star, not just an uppercased line. */
  .notebox { border: 2px solid #000; padding: 1.5mm 2mm; margin-top: 0.5mm; }
  .notehead { font-size: 11px; font-weight: 900; letter-spacing: 0.5px; }
  .notebody { font-size: 13.5px; font-weight: 800; margin-top: 0.5mm; }
  /* An update ticket must never be mistaken for a new order at a glance. */
  .upd .updhead {
    display: inline-block; border: 2px solid #000; padding: 1mm 2.5mm; margin-bottom: 1mm;
    font-size: 13px; font-weight: 900; letter-spacing: 1px;
  }
  .footer { font-size: 9.5px; color: #777; margin-top: 1.5mm; text-align: center; }
  /* Thermal cutters trim a few mm above the last line — this is the sacrifice. */
  .tail { height: 6mm; }
`

function wrap(title: string, width: '58mm' | '80mm', body: string): string {
  const mm = CONTENT_MM[width]
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${TICKET_CSS(width, mm)}</style></head><body>${body}</body></html>`
}

export function kotHtml(t: KotTicket): string {
  const width = t.paperWidth ?? '58mm'
  // Never fewer than one ticket, and capped so a bad value can't empty a roll.
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const body = Array.from({ length: copies }, () => ticketBody(t)).join('')
  return wrap(`KOT ${t.kotNumber}`, width, body)
}

export function kotUpdateHtml(t: KotUpdateTicket): string {
  const width = t.paperWidth ?? '58mm'
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const body = Array.from({ length: copies }, () => updateTicketBody(t)).join('')
  return wrap(`KOT UPDATE ${t.kotNumber}`, width, body)
}
