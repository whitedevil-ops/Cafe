import { formatDate, formatTime, DEFAULT_TIMEZONE } from '@/lib/datetime'
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

/** Pad a line out to the full paper width with the text centred inside it.
 * Only the reverse-video brand bar needs this: `ESC a 1` centres the glyphs
 * but leaves the fill hugging them, so a centred name prints as a black smudge
 * instead of a solid bar. Padding first makes the reversed run span the roll. */
function center(s: string, width: number): string {
  if (s.length >= width) return s
  const left = Math.floor((width - s.length) / 2)
  return ' '.repeat(left) + s + ' '.repeat(width - s.length - left)
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
  /** `GS B n` — white-on-black reverse video. The only way plain ESC/POS text
   * mode can render anything like the filled black brand bar the HTML ticket
   * draws: there is no background-fill equivalent for text. */
  reverse(on: boolean): this {
    this.bytes.push(GS, 0x42, on ? 1 : 0)
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

/** The identity fields a full ticket and a change ticket share. `source` is
 * always absent on an update, which is triggered by an edit rather than by the
 * order's original channel. */
type Header = {
  kotNumber: string
  tableLabel?: string | null
  orderType?: string | null
  timeLabel: string
  station?: string | null
  source?: string | null
}

const ORDER_TYPE_BADGE: Record<string, string> = { dine_in: 'DINE-IN', takeaway: 'TAKEAWAY', delivery: 'DELIVERY' }

function orderTypeBadge(orderType?: string | null): string {
  const t = (orderType ?? '').trim()
  return t ? (ORDER_TYPE_BADGE[t] ?? t.toUpperCase().replace(/_/g, '-')) : 'DINE-IN'
}

/** The one piece of branded identity this ticket carries — reverse video
 * (white text on a black fill) rather than plain bold, so it reads as "from
 * this café" before a cook reads a single word of the order. Padded to the
 * full width and printed left-aligned rather than centred by the printer: the
 * fill has to reach both edges of the roll, which it only does if the spaces
 * are really there. Omitted entirely when there's no café name to show. */
function renderBrandBar(b: Builder, cafeName: string | null | undefined, cols: number): void {
  const name = (cafeName ?? '').trim()
  if (!name) return
  b.align(0).reverse(true).bold(true)
  for (const l of wrap(name.toUpperCase(), cols)) b.line(center(l, cols))
  b.reverse(false).bold(false)
}

/** Which kind of ticket this is — "NEW ORDER", "KOT UPDATE", "REPRINT" — as
 * one loud centred line directly under the brand bar. Auto-printing can
 * legitimately emit more than one ticket for the same order, so this is what
 * stops a reprint being read as a second, unrelated order. Omitted when the
 * caller has no status to give (a test ticket), which is already
 * self-explanatory. */
function renderStatus(b: Builder, status: string | null | undefined, cols: number): void {
  const s = (status ?? '').trim()
  if (!s) return
  b.align(1).bold(true)
  for (const l of wrap(`*** ${s.toUpperCase()} ***`, cols)) b.line(l)
  b.bold(false).align(0)
}

const SOURCE_LABEL: Record<string, string> = { qr: 'QR', pos: 'POS', waiter: 'WAITER' }

/** The KOT number, then the single most prominent thing on the ticket — the
 * table if there is one, otherwise the order type — then the order type again
 * as its own line (unless it's already the hero text, which would just repeat
 * it), then the small meta block: when the order was placed, where it came
 * from, which station it belongs to.
 *
 * The ordering is the point. Staff match a paper ticket to a rack slot by its
 * number, and find the right ticket from across the pass by its table, so
 * those two are the only things printed large; everything else is context they
 * read once they are already holding the right slip. */
function renderHeader(b: Builder, h: Header, cols: number): void {
  // Double width and height, left-aligned: the second-loudest thing on the
  // ticket and the one staff actually call out to each other.
  const bigBudget = Math.max(Math.floor(cols / 2), 6)
  b.align(0).size(1, 1).bold(true)
  for (const l of wrap(`KOT #${h.kotNumber}`, bigBudget)) b.line(l)
  b.size(0, 0).bold(false)

  const badge = orderTypeBadge(h.orderType)
  const table = (h.tableLabel ?? '').trim()
  const hero = table ? `TABLE ${table.toUpperCase()}` : badge

  // Double width, triple height: a cook finds the table from across the pass
  // before reading anything else.
  b.align(1).size(1, 2).bold(true)
  for (const l of wrap(hero, bigBudget)) b.line(l)
  b.size(0, 0).bold(false)

  if (hero !== badge) {
    b.align(1).bold(true)
    for (const l of wrap(badge, cols)) b.line(l)
    b.bold(false)
  }

  // Context, not instruction: the smallest, plainest type on the ticket. The
  // time is when the order was placed, never when this happened to print — a
  // reprint pulled an hour later must still say when the guest ordered, or the
  // line dresses a stale ticket up as a fresh one.
  b.align(1)
  if (h.timeLabel) for (const l of wrap(h.timeLabel.toUpperCase(), cols)) b.line(l)

  // Source and station share one line, and it disappears entirely when there
  // is nothing to put on it rather than printing an empty label.
  const src = (h.source ?? '').trim()
  const station = (h.station ?? '').trim()
  const meta = [
    src ? `SOURCE: ${SOURCE_LABEL[src] ?? src.toUpperCase()}` : '',
    station ? `STATION: ${station.toUpperCase()}` : '',
  ].filter(Boolean)
  if (meta.length) for (const l of wrap(meta.join(' | '), cols)) b.line(l)
  b.align(0)
}

/** The column header over the item list: rule, "QTY  ITEM", rule. The list is
 * a table, so it gets headings — and the leading number then reads as a
 * quantity rather than as part of the dish name. Printed as a literal rather
 * than wrapped, since wrapping would collapse the double space that lines the
 * two columns up. */
function renderColumns(b: Builder, cols: number): void {
  b.align(0).line('-'.repeat(cols))
  b.bold(true).line('QTY  ITEM').bold(false)
  b.line('-'.repeat(cols))
}

/** "ADDED" / "REMOVED" over one half of a change ticket: big, bold, and
 * underlined by its own rule. Which half of a delta a cook is reading is far
 * too important to hang on a single +/- character at the front of a line. */
function renderGroupHead(b: Builder, title: string, cols: number): void {
  b.align(0).size(0, 1).bold(true)
  b.line(title)
  b.size(0, 0).bold(false)
  b.line('-'.repeat(cols))
}

/** One item line: quantity is the loudest part (double width *and* height,
 * bold) because a cook scans "how many" before "what"; the name follows on the
 * same physical line at double height only — still large, but visibly
 * secondary.
 *
 * The quantity token prints at double width, so it costs two columns per
 * character. Both the name's wrap budget and the indent its continuation lines
 * hang at are measured from that — otherwise a long name either overruns the
 * roll or wraps back under the quantity, which reads as a second dish. */
function itemLine(b: Builder, marker: '+' | '-' | null, qty: number, name: string, cols: number): void {
  b.align(0)
  const token = marker ? `${marker} ${qty} x ` : `${qty} x `
  const indent = Math.min(token.length * 2, Math.max(cols - 8, 0))
  const budget = Math.max(cols - indent, 8)
  b.size(1, 1).bold(true)
  b.text(token)
  b.size(0, 1)
  wrap(name, budget).forEach((l, i) => {
    if (i > 0) b.text(' '.repeat(indent))
    b.line(l)
  })
  b.size(0, 0).bold(false)
}

/** "+ Extra Cheese" / "- No Onion". Modifiers are free text — nothing in the
 * data model says which are going on the dish and which are coming off it — so
 * their own wording is the only signal there is: a leading sign, or a
 * "no"/"without"/"hold" phrasing, is a removal. Kept identical to `modLine` in
 * lib/kot-print.ts. */
function modLine(m: string): string {
  const removal = /^(-|no\b|without\b|hold\b)/i.test(m)
  return `${removal ? '-' : '+'} ${m.replace(/^[+-]\s*/, '')}`
}

/** Modifiers and the item's own note, indented under its line at normal size —
 * deliberately smaller and plainer than the double-height name above them,
 * because a modifier that reads as large as an item name reads as a second
 * dish. The note is bold and "NOTE: "-prefixed so it can't be skimmed past as
 * one more modifier. */
function itemExtras(b: Builder, item: KotItem, cols: number): void {
  const indentBudget = Math.max(cols - 2, 4)
  for (const m of (item.modifiers ?? []).map((s) => s.trim()).filter(Boolean)) {
    for (const l of wrap(modLine(m), indentBudget)) b.line(`  ${l}`)
  }
  const note = (item.note ?? '').trim()
  if (note) {
    b.bold(true)
    for (const l of wrap(`NOTE: ${note.toUpperCase()}`, indentBudget)) b.line(`  ${l}`)
    b.bold(false)
  }
}

/** The order-wide note gets its own visually heavy block, fenced top and
 * bottom — a cook glancing at a stack of tickets needs to spot "no onion on
 * anything" without reading the whole ticket. Double height on the body, since
 * this is the one piece of free text that changes how every item is made. */
function renderOrderNote(b: Builder, note: string | null | undefined, cols: number): void {
  const n = (note ?? '').trim()
  if (!n) return
  b.align(0).line('='.repeat(cols))
  b.align(1).bold(true)
  b.line('!!! ORDER NOTE !!!')
  b.align(0).size(0, 1)
  for (const l of wrap(n.toUpperCase(), cols)) b.line(l)
  b.size(0, 0).bold(false)
  b.line('='.repeat(cols))
}

/** Minimal on purpose: a rule to close the ticket off, the café's own name —
 * never the platform's — and, when a printer is set to run more than one,
 * which copy this is, so two identical slips on a pass are obviously the same
 * order rather than two of it. */
function renderFooter(b: Builder, cafeName: string | null | undefined, copy: number, copies: number, cols: number): void {
  b.align(0).line('-'.repeat(cols))
  b.align(1)
  const name = (cafeName ?? '').trim()
  if (name) for (const l of wrap(name, cols)) b.line(l)
  if (copies > 1) b.line(`COPY ${copy}/${copies}`)
  b.align(0)
}

/** One list of items, marked and separated. A light dotted rule between dishes,
 * never before the first or after the last — real structure separating one item
 * from the next instead of relying on blank-line spacing alone. */
function renderItems(b: Builder, items: KotItem[], marker: '+' | '-' | null, cols: number): void {
  items.forEach((item, i) => {
    if (i > 0) b.line('.'.repeat(cols))
    itemLine(b, marker, item.qty, item.name, cols)
    itemExtras(b, item, cols)
    b.feed(1)
  })
}

/** "23 JUL 2026 - 7:42 PM", in the café's own zone — when the order was
 * placed, never when it happened to print. */
function timeLabelOf(t: { placedAt: string; timezone?: string }): string {
  const tz = t.timezone || DEFAULT_TIMEZONE
  return `${formatDate(t.placedAt, tz)} - ${formatTime(t.placedAt, tz)}`.toUpperCase()
}

function renderOne(b: Builder, t: KotTicket, cols: number, copy: number, copies: number): void {
  renderBrandBar(b, t.cafeName, cols)
  renderStatus(b, t.status, cols)
  renderHeader(
    b,
    { kotNumber: t.kotNumber, tableLabel: t.tableLabel, orderType: t.orderType, timeLabel: timeLabelOf(t), station: t.station, source: t.source },
    cols,
  )

  renderColumns(b, cols)
  renderItems(b, t.items, null, cols)

  renderOrderNote(b, t.orderNote, cols)
  renderFooter(b, t.cafeName, copy, copies, cols)
  b.feed(3).cut()
}

function renderUpdateOne(b: Builder, t: KotUpdateTicket, cols: number, copy: number, copies: number): void {
  renderBrandBar(b, t.cafeName, cols)
  // A status line unmistakably different from a new order's, so a cook can
  // never mistake a change slip for a brand new order.
  renderStatus(b, 'KOT UPDATE', cols)
  renderHeader(
    b,
    { kotNumber: t.kotNumber, tableLabel: t.tableLabel, orderType: t.orderType, timeLabel: timeLabelOf(t), station: t.station },
    cols,
  )

  renderColumns(b, cols)

  // Two titled groups rather than one run of +/- lines. A group with nothing
  // in it is not printed at all: an empty "REMOVED" heading is worse than no
  // heading, because it invites a cook to go hunting for what is missing.
  if (t.added.length) {
    renderGroupHead(b, 'ADDED', cols)
    renderItems(b, t.added, '+', cols)
  }
  if (t.removed.length) {
    renderGroupHead(b, 'REMOVED', cols)
    renderItems(b, t.removed, '-', cols)
  }

  // The whole point of the slip, spelled out: everything not listed above was
  // already sent and is already being made.
  b.align(0).line('-'.repeat(cols))
  b.align(1).bold(true)
  b.line('PREPARE CHANGES ONLY')
  b.bold(false).align(0)

  renderOrderNote(b, t.orderNote, cols)
  renderFooter(b, t.cafeName, copy, copies, cols)
  b.feed(3).cut()
}

export function kotEscPos(t: KotTicket): Uint8Array {
  const cols = columns(t.paperWidth)
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const b = new Builder()
  for (let i = 0; i < copies; i++) renderOne(b, t, cols, i + 1, copies)
  return b.build()
}

export function kotUpdateEscPos(t: KotUpdateTicket): Uint8Array {
  const cols = columns(t.paperWidth)
  const copies = Math.min(5, Math.max(1, t.copies ?? 1))
  const b = new Builder()
  for (let i = 0; i < copies; i++) renderUpdateOne(b, t, cols, i + 1, copies)
  return b.build()
}
