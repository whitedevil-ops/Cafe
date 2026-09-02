import { formatDate, formatTime, DEFAULT_TIMEZONE } from '@/lib/datetime'
import { isDesktopApp } from '@/lib/is-desktop'
import type { KotTicket } from '@/lib/kot-print'

// Printing straight to the printer, available only inside the desktop app.
//
// The browser path renders HTML and hands it to a Windows driver, which means
// a print dialog, a driver that must exist, and a browser window that has to
// stay open. This path writes ESC/POS bytes to the printer itself — no dialog,
// no driver, and it can reach a network printer, which no browser can.
//
// Which printer is a property of the *machine*, not of the café: two counters
// running the same café will have been given different COM ports by Windows.
// So it lives in localStorage on that install rather than in the database.

export type DesktopPrinter =
  | { kind: 'serial'; port: string; baud?: number }
  | { kind: 'tcp'; host: string; port?: number }

const KEY = 'kp:desktop:printer'

export function getDesktopPrinter(): DesktopPrinter | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DesktopPrinter) : null
  } catch {
    return null
  }
}

export function setDesktopPrinter(target: DesktopPrinter | null): void {
  try {
    if (target) localStorage.setItem(KEY, JSON.stringify(target))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable — native printing just stays off on this machine.
  }
}

/**
 * Reach the Rust side. Uses the global the desktop app injects rather than
 * importing @tauri-apps/api, so the web bundle carries no Tauri dependency and
 * a plain browser is unaffected.
 */
async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: (c: string, a: unknown) => Promise<T> } }
  }
  const fn = w.__TAURI__?.core?.invoke
  if (!fn) throw new Error('not running in the desktop app')
  return fn(cmd, args)
}

/** Every COM port Windows can see, so staff pick from a list. */
export async function listSerialPorts(): Promise<string[]> {
  if (!isDesktopApp()) return []
  try {
    return await invoke<string[]>('list_serial_ports', {})
  } catch {
    return []
  }
}

/**
 * The one canonical ticket timestamp, matching lib/kot-print.ts's metaLine()
 * and desktop/src-tauri/src/bridge.rs's format_time_label(). All three print
 * paths must render an order's time identically — a café should not be able
 * to tell which one produced the paper in their hand.
 */
function nativeTimeLabel(t: KotTicket): string {
  const tz = t.timezone || DEFAULT_TIMEZONE
  return `${formatDate(t.placedAt, tz).toUpperCase()} - ${formatTime(t.placedAt, tz)}`
}

/** Shape the Rust side expects — snake_case, and the time already formatted. */
function toNativeTicket(t: KotTicket) {
  return {
    kot_number: t.kotNumber,
    table_label: t.tableLabel ?? null,
    order_type: t.orderType ?? null,
    // The printer has no idea what zone the café is in and Rust must not
    // guess, so the string is finished here. Date included, and in the same
    // shape as lib/kot-print.ts's metaLine() ("01 SEP 2026 - 10:32 PM"): this
    // used to send the time alone, so a natively-printed ticket carried no
    // date at all while the browser-printed one did — the same order, printed
    // two ways, disagreeing about what a cook was looking at.
    time_label: nativeTimeLabel(t),
    station: t.station ?? null,
    source: t.source ?? null,
    cafe_name: t.cafeName ?? null,
    items: t.items.map((i) => ({
      qty: i.qty,
      name: i.name,
      modifiers: i.modifiers ?? [],
      note: i.note ?? null,
    })),
    order_note: t.orderNote ?? null,
    paper_mm: t.paperWidth === '80mm' ? 80 : 58,
    copies: t.copies ?? 1,
  }
}

/**
 * Try to print natively. Returns false when this isn't the desktop app or
 * nothing could be printed to, so the caller can fall back to the browser
 * path.
 *
 * Throws only when a printer *is* explicitly configured (serial/tcp) and the
 * write failed — an unplugged printer or a wrong COM port is worth telling
 * staff about, and must not silently fall back to opening a print dialog
 * nobody expected.
 *
 * When nothing is explicitly configured, this opportunistically tries
 * whichever printer Windows itself currently treats as default (the whole
 * point: a café's one thermal printer becomes usable the moment it's
 * installed, with nothing to set up in KhaoPiyo) — but that attempt is
 * allowed to fail quietly, since a fresh machine with no real printer
 * installed yet is exactly what the dialog fallback exists for.
 */
export async function printKotNative(ticket: KotTicket): Promise<boolean> {
  if (!isDesktopApp()) return false
  const target = getDesktopPrinter()
  if (target) {
    await invoke<void>('print_ticket', { target, ticket: toNativeTicket(ticket) })
    return true
  }
  try {
    // Keep this object to exactly { kind: 'windows' } — the Rust side treats
    // it as a unit variant, which serde's internally-tagged representation
    // only accepts when the tag is the only key present. Adding a field
    // here needs a matching change to Target::Windows in printing.rs first.
    await invoke<void>('print_ticket', { target: { kind: 'windows' }, ticket: toNativeTicket(ticket) })
    return true
  } catch {
    return false
  }
}

/** Same path as a real ticket, so a test proves the real thing works. */
export async function testPrintNative(paperWidth: '58mm' | '80mm', timezone: string): Promise<boolean> {
  return printKotNative({
    kotNumber: 'TEST',
    orderType: 'dine_in',
    tableLabel: null,
    placedAt: new Date().toISOString(),
    timezone,
    paperWidth,
    items: [
      { qty: 1, name: 'Test ticket', modifiers: ['If you can read this, printing works'] },
      { qty: 2, name: 'Paper width check' },
    ],
    orderNote: 'This is a test — nothing was ordered',
  })
}
