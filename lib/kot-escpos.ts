import { formatTime, DEFAULT_TIMEZONE } from '@/lib/datetime'
import type { KotTicket, KotUpdateTicket, KotItem } from '@/lib/kot-print'

// Kitchen ticket -> ESC/POS bytes, for printing straight to a Bluetooth
// thermal printer from the browser (Web Bluetooth — see lib/bluetooth-print.ts).
//
// A faithful TypeScript port of desktop/src-tauri/src/escpos.rs — same
// hierarchy, same content, same command bytes — so a ticket looks identical
// whether it came from the desktop app or a browser's own Bluetooth
// connection. Keep the two in sync: a layout change on one side belongs on
// both. Deliberately pure: KotTicket/KotUpdateTicket in, bytes out, no I/O.

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** Characters per line at the standard font. 58mm paper is 32, 80mm is 48. */
function columns(paperWidth: '58mm' | '80mm' | undefined): number {
  return paperWidth === '80mm' ? 48 : 32
}

/** These printers speak a single-byte codepage, not UTF-8. Restrict to ASCII
 * and drop the rest — a mangled item name in a hot kitchen is worse than a
 * missing accent. */
function ascii(s: string): string {
  let out = ''
  for (const c of s) {
    if (c === '₹') out += 'R'
    else if (c === '—' || c === '–') out += '-'
    else if (c === '’' || c === '‘') out += "'"
    else if (c === '“' || c === '”') out += '"'
    else if (c.charCodeAt(0) < 128) out += c
    else out += '?'
  }
  return out
}

/** Wrap on word boundaries, breaking a word only when it cannot fit alone. */
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > width) {
      if (line) { out.push(line); line = '' }
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width))
      continue
    }
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ' ' + word
    else { out.push(line); line = word }
  }
  if (line) out.push(line)
  if (out.length === 0) out.push('')
  return out
}

class Builder {
  private bytes: number[] = [ESC, 0x40] // initialise
  size(w: number, h: number): this {
    this.bytes.push(GS, 0x21, ((Math.min(w, 7) << 4) | Math.min(h, 7)) & 0xff)
    return this
  }
  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0)
    return this
  }
  align(n: 0 | 1 | 2): this {
    this.bytes.push(ESC, 0x61, n)
    return this
  }
  text(s: string): this {
    for (const c of ascii(s)) this.bytes.push(c.charCodeAt(0))
    return this
  }
  line(s: string): this {
    this.text(s)
    this.bytes.push(LF)
    return this
  }
  feed(n: number): this {
    this.bytes.push(ESC, 0x64, n)
    return this
  }
  /** Partial cut after feeding the blade clear of the last line. Printers
   * without a cutter ignore it, which is why it is always sent. */
  cut(): this {
    this.bytes.push(GS, 0x56, 66, 0)
    return this
  }
  build(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

type Header = {
  kotNumber: string
  tableLabel?: string | null
  orderType?: string | null
  timeLabel: string
  station?: string | null
}

const ORDER_TYPE_BADGE: Record<string, string> = { dine_in: 'DINE-IN', takeaway: 'TAKEAWAY', delivery: 'DELIVERY' }

function orderTypeBadge(orderType?: string | null): string {
  const t = (orderType ?? '').trim()
  return t ? (ORDER_TYPE_BADGE[t] ?? t.toUpperCase().replace(/_/g, '-')) : 'DINE-IN'
}

function renderHeader(b: Builder, h: Header, cols: number): void {
  const station = (h.station ?? '').trim()
  if (station) {
    b.align(1).bold(true)
    for (const l of wrap(station.toUpperCase(), cols)) b.line(l)
    b.bold(false)
  }

  const badge = orderTypeBadge(h.orderType)
  const table = (h.tableLabel ?? '').trim()
  const dominant = table ? `TABLE ${table}` : badge

  // Double width, triple height: a cook finds the table from across the
  // pass before reading anything else.
  b.align(1).size(1, 2).bold(true)
  const domBudget = Math.max(Math.floor(cols / 2), 6)
  for (const l of wrap(dominant, domBudget)) b.line(l)
  b.size(0, 0).bold(false)

  if (dominant !== badge) {
    b.align(1).bold(true)
    for (const l of wrap(badge, cols)) b.line(l)
    b.bold(false)
  }

  b.align(0).bold(true)
  const meta = h.timeLabel ? `#${h.kotNumber}   ${h.timeLabel}` : `#${h.kotNumber}`
  for (const l of wrap(meta, cols)) b.line(l)
  b.bold(false)

  b.line('-'.repeat(cols))
}

/** Physical width, in normal-width columns, reserved at the front of an item
 * line for its quantity token — fixed and generous rather than measured. */
const QTY_TOKEN_RESERVE = 16

function itemLine(b: Builder, marker: '+' | '-' | null, qty: number, name: string, cols: number): void {
  b.align(0)
  const token = marker ? `${marker} ${qty} x ` : `${qty} x `
  b.size(1, 1).bold(true)
  b.text(token)
  b.size(0, 1)
  const budget = Math.max(cols - QTY_TOKEN_RESERVE, 8)
  for (const l of wrap(name, budget)) b.line(l)
  b.size(0, 0).bold(false)
}

function itemExtras(b: Builder, item: KotItem, cols: number): void {
  const indentBudget = Math.max(cols - 2, 4)
  for (const m of (item.modifiers ?? []).map((s) => s.trim()).filter(Boolean)) {
    for (const l of wrap(`+ ${m}`, indentBudget)) b.line(`  ${l}`)
  }
  const note = (item.note ?? '').trim()
  if (note) {
    b.bold(true)
    for (const l of wrap(`! ${note.toUpperCase()}`, indentBudget)) b.line(`  ${l}`)
    b.bold(false)
  }
}

function renderKitchenNote(b: Builder, note: string | null | undefined, cols: number): void {
  const n = (note ?? '').trim()
  if (!n) return
  b.line('='.repeat(cols))
  b.align(1).bold(true)
  b.line('*** KITCHEN NOTE ***')
  b.align(0)
  for (const l of wrap(n.toUpperCase(), cols)) b.line(l)
  b.bold(false)
  b.line('='.repeat(cols))
}

const SOURCE_LABEL: Record<string, string> = { qr: 'QR', pos: 'POS', waiter: 'WAITER' }

function renderFooter(b: Builder, source: string | null | undefined, cafeName: string | null | undefined, cols: number): void {
  b.align(1)
  const src = (source ?? '').trim()
  if (src) for (const l of wrap(`via ${SOURCE_LABEL[src] ?? src.toUpperCase()}`, cols)) b.line(l)
  const name = (cafeName ?? '').trim()
  if (name) for (const l of wrap(name, cols)) b.line(l)
}

function timeLabelOf(t: { placedAt: string; timezone?: string }): string {
  return formatTime(t.placedAt, t.timezone || DEFAULT_TIMEZONE)
}

function renderOne(b: Builder, t: KotTicket, cols: number): void {
  renderHeader(b, { kotNumber: t.kotNumber, tableLabel: t.tableLabel, orderType: t.orderType, timeLabel: timeLabelOf(t), station: t.station }, cols)
  for (const item of t.items) {
    itemLine(b, null, item.qty, item.name, cols)
    itemExtras(b, item, cols)
    b.feed(1)
  }
  renderKitchenNote(b, t.orderNote, cols)
  renderFooter(b, t.source, t.cafeName, cols)
  b.feed(3).cut()
}

function renderUpdateOne(b: Builder, t: KotUpdateTicket, cols: number): void {
  b.align(1).bold(true)
  b.line('*** KOT UPDATE ***')
  b.bold(false)
  renderHeader(b, { kotNumber: t.kotNumber, tableLabel: t.tableLabel, orderType: t.orderType, timeLabel: timeLabelOf(t), station: t.station }, cols)
  for (const item of t.added) {
    itemLine(b, '+', item.qty, item.name, cols)
    itemExtras(b, item, cols)
    b.feed(1)
  }
  for (const item of t.removed) {
    itemLine(b, '-', item.qty, item.name, cols)
    itemExtras(b, item, cols)
    b.feed(1)
  }
  renderKitchenNote(b, t.orderNote, cols)
  renderFooter(b, null, t.cafeName, cols)
  b.feed(3).cut()
}

export function kotEscPos(t: KotTicket): Uint8Array {
  const cols = columns(t.paperWidth)
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const b = new Builder()
  for (let i = 0; i < copies; i++) renderOne(b, t, cols)
  return b.build()
}

export function kotUpdateEscPos(t: KotUpdateTicket): Uint8Array {
  const cols = columns(t.paperWidth)
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const b = new Builder()
  for (let i = 0; i < copies; i++) renderUpdateOne(b, t, cols)
  return b.build()
}
