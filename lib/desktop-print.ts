import { formatTime, DEFAULT_TIMEZONE } from '@/lib/datetime'
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

/** Shape the Rust side expects — snake_case, and the time already formatted. */
function toNativeTicket(t: KotTicket) {
  return {
    kot_number: t.kotNumber,
    table_label: t.tableLabel ?? null,
    order_type: t.orderType ?? null,
    // The printer has no idea what zone the café is in and Rust must not
    // guess, so the string is finished here.
    time_label: formatTime(t.placedAt, t.timezone || DEFAULT_TIMEZONE),
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
 * Try to print natively. Returns false when this isn't the desktop app or no
 * printer has been chosen on this machine, so the caller can fall back to the
 * browser path.
 *
 * Throws only when a printer *is* configured and the write failed — an
 * unplugged printer or a wrong COM port is worth telling staff about, and must
 * not silently fall back to opening a print dialog nobody expected.
 */
export async function printKotNative(ticket: KotTicket): Promise<boolean> {
  if (!isDesktopApp()) return false
  const target = getDesktopPrinter()
  if (!target) return false
  await invoke<void>('print_ticket', { target, ticket: toNativeTicket(ticket) })
  return true
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
