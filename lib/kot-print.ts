import { formatDate, formatTime, DEFAULT_TIMEZONE } from '@/lib/datetime'

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
  /** "NEW ORDER" / "REPRINT" — which `print_jobs.kind` produced this ticket,
   *  set by whoever queued it rather than derived here. Printed as its own
   *  loud line, because auto-printing can legitimately emit more than one
   *  ticket for the same order and a reprint must never be mistaken for a
   *  second one. Absent on a test ticket, which is self-explanatory already.
   *  Mirrors `Ticket::status` in desktop/src-tauri/src/escpos.rs; a change
   *  ticket needs no equivalent, since its status is always "KOT UPDATE". */
  status?: string | null
}

/** A change-KOT: a delta against whatever was already sent to this printer
 * for this order, not a full re-ticket. Kept as a visually distinct layout
 * (a "*** KOT UPDATE ***" status line, ADDED/REMOVED sections, and a closing
 * "PREPARE CHANGES ONLY") so it can never be mistaken for a new order at a
 * glance. Its `source` is deliberately not printed — see updateTicketBody. */
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

/** Everything below returns plain text unless its name says otherwise, and
 * escaping happens at the point a value lands in markup. */
const clean = (s?: string | null): string => (s ?? '').trim()

/** The single biggest thing on the ticket — what a cook reads from across
 * the kitchen. The table if the order has one, otherwise the order type,
 * since a takeaway has no table to shout about (spec: never show irrelevant
 * table info). Same rule as the ESC/POS renderers' `dominant`. */
function heroLabel(t: { orderType?: string | null; tableLabel?: string | null }): string {
  const table = clean(t.tableLabel)
  return table ? `TABLE ${table.toUpperCase()}` : orderTypeLabel(t.orderType)
}

/** "23 JUL 2026 - 7:42 PM", in the café's zone. This is when the order was
 * PLACED, never when it was printed: a reprint pulled at 9pm for a 7:42
 * order still has to read 7:42, or the line dresses a stale ticket up as a
 * fresh one. */
function metaLine(placedAt: string, timezone: string | undefined): string {
  const tz = timezone || DEFAULT_TIMEZONE
  return `${esc(formatDate(placedAt, tz).toUpperCase())} - ${esc(formatTime(placedAt, tz))}`
}

const SOURCE_LABEL: Record<string, string> = { qr: 'QR', pos: 'POS', waiter: 'WAITER' }

/** Where the order came from and which station it belongs to, on their own
 * line under the time. Context rather than instruction — nothing a cook has
 * to act on — so it stays small, and disappears entirely when there is
 * nothing to say instead of printing an empty label. */
function subLine(source?: string | null, station?: string | null): string {
  const src = clean(source)
  const stn = clean(station)
  const parts = [
    src ? `SOURCE: ${esc(SOURCE_LABEL[src] ?? src.toUpperCase())}` : '',
    stn ? `STATION: ${esc(stn.toUpperCase())}` : '',
  ].filter(Boolean)
  return parts.length ? `<div class="meta">${parts.join(' &bull; ')}</div>` : ''
}

/** Minimal on purpose: the café's own name — never the platform's — and,
 * when one job prints more than one ticket, which of them this is. A cook
 * holding the pass copy and the line copy of the same order must be able to
 * tell they are not two orders. */
function footerLine(cafeName: string | null | undefined, copy: number, copies: number): string {
  const name = clean(cafeName)
  return [
    name ? `<div class="footer">${esc(name)}</div>` : '',
    copies > 1 ? `<div class="copy">COPY ${copy}/${copies}</div>` : '',
  ].join('')
}

/** "*** REPRINT ***". Auto-printing can legitimately emit more than one
 * ticket for the same order, and a cook who reads a reprint as a second
 * order cooks the food twice — so which kind of ticket this is has to be
 * readable before anything else on it. Absent on a test ticket, which needs
 * no explaining. */
function statusLine(status?: string | null): string {
  const s = clean(status)
  return s ? `<div class="status">*** ${esc(s.toUpperCase())} ***</div>` : ''
}

/** "+ Extra Cheese" / "- No Onion". Modifiers are free text, so their own
 * wording is the only signal available: a leading sign, or a "no"/"without"/
 * "hold" phrasing, is something coming off the dish; anything else is going
 * on it. */
function modLine(m: string): string {
  const removal = /^(-|no\b|without\b|hold\b)/i.test(m)
  return `${removal ? '-' : '+'} ${esc(m.replace(/^[+-]\s*/, ''))}`
}

/** One item: quantity boxed and large because a cook scans "how many" before
 * "what", the dish name larger still, then anything qualifying it indented
 * underneath and visibly plainer so a modifier can never read as a second
 * dish. `marker` prefixes the quantity on a change-KOT line. */
function itemLine(i: KotItem, marker?: '+' | '-'): string {
  const mods = (i.modifiers ?? []).map((m) => m.trim()).filter(Boolean)
  const note = clean(i.note)
  const markerCls = marker === '+' ? ' add' : marker === '-' ? ' rm' : ''
  return [
    `<div class="item${markerCls}">`,
    `<div class="line"><span class="qty">${marker ? esc(marker) + ' ' : ''}${esc(String(i.qty))}&times;</span><span class="nm">${esc(i.name)}</span></div>`,
    mods.length ? `<div class="mod">${mods.map(modLine).join('<br/>')}</div>` : '',
    note ? `<div class="note">NOTE: ${esc(note.toUpperCase())}</div>` : '',
    '</div>',
  ].join('')
}

/** One labelled list of items — the two halves of a change-KOT. Printed only
 * when it has something in it: an empty "REMOVED" heading is worse than no
 * heading, because it invites a cook to go looking for what is missing. */
function itemGroup(label: string, items: KotItem[], marker: '+' | '-'): string {
  if (!items.length) return ''
  return `<div class="grouphead">${label}</div><div class="items">${items.map((i) => itemLine(i, marker)).join('')}</div>`
}

function noteBox(orderNote?: string | null): string {
  const note = clean(orderNote)
  if (!note) return ''
  return `<div class="notebox"><div class="notehead">!!! ORDER NOTE !!!</div><div class="notebody">${esc(note.toUpperCase())}</div></div>`
}

/** The item list is a table, so it gets column headings, fenced top and
 * bottom the same way the ESC/POS tickets fence theirs. */
const COL_HEAD =
  '<div class="cols"><div class="rule"></div>' +
  '<div class="colhead"><span class="qtycol">QTY</span><span>ITEM</span></div>' +
  '<div class="rule"></div></div>'

/** The identity block both ticket kinds share: brand bar, status, KOT
 * number, hero line, order type, time, source/station. Kept in one place so
 * a change-KOT can never drift into looking like a different document than
 * the full ticket it amends. */
function headerBlock(
  t: {
    kotNumber: string
    cafeName?: string | null
    tableLabel?: string | null
    orderType?: string | null
    placedAt: string
    timezone?: string
    station?: string | null
    source?: string | null
  },
  status: string,
): string {
  const cafe = clean(t.cafeName)
  const hero = heroLabel(t)
  const otype = orderTypeLabel(t.orderType)

  return [
    // The one splash of branded identity a thermal ticket can carry —
    // everything below stays plain black-on-white for legibility across a
    // hot kitchen, but this reversed bar is what stops it reading as a
    // generic till-roll printout. It is also the only branding on here: a
    // cook needs the order, not the logo.
    cafe ? `<div class="brandbar">${esc(cafe)}</div>` : '',
    statusLine(status),
    `<div class="kotno">KOT #${esc(t.kotNumber)}</div>`,
    `<div class="hero">${esc(hero)}</div>`,
    // Skipped when it would only repeat the hero line back. "TAKEAWAY"
    // twice in a row reads as a rendering fault, not as emphasis.
    hero === otype ? '' : `<div class="otype">${esc(otype)}</div>`,
    `<div class="meta">${metaLine(t.placedAt, t.timezone)}</div>`,
    subLine(t.source, t.station),
  ].join('')
}

function ticketBody(t: KotTicket, copy: number, copies: number): string {
  return [
    '<div class="kot">',
    headerBlock(t, t.status ?? ''),
    COL_HEAD,
    t.items.length ? `<div class="items">${t.items.map((i) => itemLine(i)).join('')}</div>` : '',
    noteBox(t.orderNote),
    '<div class="rule solid"></div>',
    footerLine(t.cafeName, copy, copies),
    '<div class="tail"></div>',
    '</div>',
  ].join('')
}

function updateTicketBody(t: KotUpdateTicket, copy: number, copies: number): string {
  return [
    '<div class="kot upd">',
    // A change-KOT has only ever one status, so it is stated here rather than
    // carried on the ticket: this is the one document that must never be read
    // as a new order. No source either — a change is triggered by someone
    // editing the order, not by the channel the order first arrived on, so
    // "SOURCE: QR" here would name the wrong cause.
    headerBlock({ ...t, source: null }, 'KOT UPDATE'),
    COL_HEAD,
    itemGroup('ADDED', t.added, '+'),
    itemGroup('REMOVED', t.removed, '-'),
    // The whole point of the slip: what is on it is the delta, not the
    // order. Without this line a cook can reasonably re-fire the lot.
    '<div class="prepare">PREPARE CHANGES ONLY</div>',
    noteBox(t.orderNote),
    '<div class="rule solid"></div>',
    footerLine(t.cafeName, copy, copies),
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
     "from this café" before a cook reads a single word of the order — and
     the only filled block above the order note, so it can never outweigh the
     order itself. Mirrors the ESC/POS renderers' reverse-video bar (GS B). */
  .brandbar {
    background: #000; color: #fff; margin: 0 0 2mm; padding: 1.6mm 1mm;
    font-size: 12px; font-weight: 800; letter-spacing: 1.5px; text-align: center;
    text-transform: uppercase; overflow-wrap: anywhere;
  }
  /* Which kind of ticket this is, before anything about the order. Sized so
     the longest of them, "*** KOT UPDATE ***", still clears 48mm on one line. */
  .status { font-size: 13px; font-weight: 900; letter-spacing: 1px; text-align: center; }
  /* Left-aligned and heavy: the number staff call out and search a rail for,
     and the most findable thing on here after the hero line. */
  .kotno { font-size: 17px; font-weight: 900; letter-spacing: 0.5px; margin-top: 1mm; }
  /* The single biggest thing on the ticket — read from across the kitchen.
     The size is the largest that still sets "TAKEAWAY" on one line at 48mm:
     it is one long word, so the wrap it would otherwise take is a mid-word
     break, and "TAKEAWA / Y" is not a thing anyone should have to read off a
     ticket. 80mm has the room for more, and a hero is exactly where the
     extra 24mm is worth spending. */
  .hero {
    font-size: ${width === '80mm' ? 34 : 26}px;
    font-weight: 900; line-height: 1.05; letter-spacing: -0.5px;
    text-align: center; margin-top: 0.5mm; overflow-wrap: anywhere;
  }
  .otype { font-size: 13px; font-weight: 800; letter-spacing: 2px; text-align: center; margin-top: 0.5mm; }
  /* Context, not instruction, so it is the smallest type on the ticket. */
  .meta { font-size: 10.5px; text-align: center; margin-top: 0.8mm; overflow-wrap: anywhere; }

  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  /* A solid rule reads as a real section break; dashed is for "more of the
     same list continues" — the footer is neither, so it gets the heavier one. */
  .rule.solid { border-top: 1.5px solid #000; }
  /* The item list is a table, so it gets column headings. Its two rules sit
     tighter than a section break because they belong to the rows below. */
  .cols .rule { margin: 1.5mm 0; }
  .colhead { display: flex; gap: 2mm; font-size: 10px; font-weight: 800; letter-spacing: 1.5px; }
  .qtycol { flex: 0 0 auto; width: 9mm; text-align: center; }

  /* A dotted rule BETWEEN dishes. The adjacent-sibling selector is what keeps
     it off the first and the last one without the renderer having to count,
     and it resets per list, so a change-KOT's ADDED and REMOVED blocks never
     bleed into each other. */
  .item { padding: 1.6mm 0; }
  .item + .item { border-top: 1px dotted #000; }
  .line { display: flex; gap: 2mm; align-items: flex-start; }
  /* Boxed rather than bare bold text — a ticket-stub qty marker reads as
     deliberately designed, not just "big number, hope it stands out". */
  .qty {
    flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    min-width: 9mm; font-size: 15px; font-weight: 900; line-height: 1.25;
    border: 1.4px solid #000; padding: 0.4mm 1mm;
  }
  /* min-width:0 is load-bearing: a flex child otherwise refuses to shrink
     below its longest word, and one 30-character dish name would print off
     the edge of the roll rather than wrapping. */
  .nm { flex: 1 1 auto; min-width: 0; font-size: 18px; font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }
  /* Indented clear of the qty box and visibly plainer than the dish name — a
     modifier must never read as a dish of its own. */
  .mod { font-size: 11px; padding-left: 11mm; line-height: 1.45; overflow-wrap: anywhere; }
  .note { font-size: 11.5px; font-weight: 800; padding-left: 11mm; margin-top: 0.6mm; overflow-wrap: anywhere; }
  /* Struck through rather than coloured. Thermal paper has no greys worth
     having — a printer dithers a dark red into a faint speckle — so every
     distinction on this ticket is size, weight or a rule, never a hue. */
  .item.rm .nm { text-decoration: line-through; }
  /* A change-KOT's two lists must never blur into one another. */
  .grouphead {
    font-size: 13px; font-weight: 900; letter-spacing: 2px;
    border-bottom: 1.5px solid #000; padding-bottom: 0.6mm; margin: 2mm 0 0.5mm;
  }
  /* Sized to hold on one line at 48mm — "PREPARE CHANGES / ONLY" broken over
     two reads like a sentence trailing off, not like an instruction. */
  .prepare { font-size: 11px; font-weight: 900; letter-spacing: 0.5px; text-align: center; margin-top: 2mm; }

  /* An order note is the one thing that must never blend into the rest of
     the ticket — a bordered box, not just an uppercased line. */
  .notebox { border: 2px solid #000; padding: 1.5mm 2mm; margin-top: 2mm; }
  .notehead { font-size: 12px; font-weight: 900; letter-spacing: 1px; text-align: center; }
  .notebody { font-size: 14px; font-weight: 800; margin-top: 0.8mm; overflow-wrap: anywhere; }

  .footer { font-size: 10.5px; font-weight: 700; letter-spacing: 0.5px; text-align: center; margin-top: 1.5mm; overflow-wrap: anywhere; }
  .copy { font-size: 10.5px; font-weight: 800; text-align: center; margin-top: 0.5mm; }
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
  const body = Array.from({ length: copies }, (_, i) => ticketBody(t, i + 1, copies)).join('')
  return wrap(`KOT ${t.kotNumber}`, width, body)
}

export function kotUpdateHtml(t: KotUpdateTicket): string {
  const width = t.paperWidth ?? '58mm'
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const body = Array.from({ length: copies }, (_, i) => updateTicketBody(t, i + 1, copies)).join('')
  return wrap(`KOT UPDATE ${t.kotNumber}`, width, body)
}
