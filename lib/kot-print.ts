import { formatTime, DEFAULT_TIMEZONE } from '@/lib/datetime'

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
// so the layout rules can be tested without a browser.

export type KotItem = {
  qty: number
  name: string
  modifiers?: string[]
  note?: string | null
}

export type KotTicket = {
  /** Short order code — the biggest thing on the paper. */
  kotNumber: string
  tableLabel?: string | null
  orderType?: string | null
  /** ISO timestamp; formatted in the café's zone, never the machine's. */
  placedAt: string
  timezone?: string
  station?: string | null
  paperWidth?: '58mm' | '80mm'
  items: KotItem[]
  orderNote?: string | null
  /** Identical tickets to emit, e.g. one for the pass and one for the line. */
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

function ticketBody(t: KotTicket): string {
  const width = t.paperWidth ?? '58mm'
  const tz = t.timezone || DEFAULT_TIMEZONE
  const takeaway = t.orderType === 'takeaway'

  const meta = [
    takeaway ? 'TAKEAWAY' : t.tableLabel ? `Table ${esc(t.tableLabel)}` : 'Dine-in',
    esc(formatTime(t.placedAt, tz)),
  ].join(' · ')

  const items = t.items
    .map((i) => {
      const mods = (i.modifiers ?? []).filter(Boolean)
      return [
        '<div class="item">',
        `<div class="line"><span class="qty">${i.qty}</span><span class="nm">${esc(i.name)}</span></div>`,
        mods.length ? `<div class="mod">+ ${mods.map(esc).join(', ')}</div>` : '',
        i.note ? `<div class="note">${esc(i.note.toUpperCase())}</div>` : '',
        '</div>',
      ].join('')
    })
    .join('')

  return [
    '<div class="kot">',
    `<div class="num">#${esc(t.kotNumber)}</div>`,
    `<div class="meta">${meta}</div>`,
    t.station ? `<div class="meta">${esc(t.station)}</div>` : '',
    `<div class="rule"></div>`,
    items,
    t.orderNote
      ? `<div class="rule"></div><div class="ordernote">NOTE: ${esc(t.orderNote.toUpperCase())}</div>`
      : '',
    `<div class="tail"></div>`,
    '</div>',
    `<!-- width:${width} -->`,
  ].join('')
}

export function kotHtml(t: KotTicket): string {
  const width = t.paperWidth ?? '58mm'
  const mm = CONTENT_MM[width]
  // Never fewer than one ticket, and capped so a bad value can't empty a roll.
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const body = Array.from({ length: copies }, () => ticketBody(t)).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>KOT ${esc(t.kotNumber)}</title><style>
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
  .num { font-size: 30px; font-weight: 800; line-height: 1.1; letter-spacing: -0.5px; }
  .meta { font-size: 12px; font-weight: 600; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  .item { margin-bottom: 2.5mm; }
  /* The cook reads this across a pass, so quantity and name are the largest
     things after the order number, and never wrap into an indistinct block. */
  .line { display: flex; gap: 2mm; align-items: baseline; }
  .qty { font-size: 20px; font-weight: 800; min-width: 7mm; }
  .nm { font-size: 17px; font-weight: 700; line-height: 1.2; word-break: break-word; }
  .mod { font-size: 12px; padding-left: 9mm; }
  .note, .ordernote { font-size: 12px; font-weight: 700; padding-left: 9mm; }
  .ordernote { padding-left: 0; }
  /* Thermal cutters trim a few mm above the last line — this is the sacrifice. */
  .tail { height: 6mm; }
</style></head><body>${body}</body></html>`
}
