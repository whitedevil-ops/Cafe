import { kotEscPos } from '@/lib/kot-escpos'
import type { KotTicket } from '@/lib/kot-print'

// Printing straight to a Bluetooth thermal printer, from the browser itself —
// no desktop app, no OS-level pairing, no driver. Uses the Web Bluetooth API,
// which only exists in Chrome/Edge on Android, Windows, macOS and Linux — it
// is not available in Safari on any platform (Apple blocks the API outright)
// or in Firefox by default. isBluetoothSupported() feature-detects this so
// callers can offer the OS-print-dialog path instead where it's missing.
//
// Which printer is a property of the *browser profile on this device*, same
// reasoning as desktop-print.ts's serial/TCP target: it lives in localStorage,
// not the database.
//
// Compatibility is the hard part. Cheap thermal printers speak ESC/POS over a
// vendor-specific BLE GATT service — there is no single standard UUID every
// printer uses. Rather than hardcode one vendor's UUID and fail on everyone
// else's, connectBluetoothPrinter() asks for a handful of the most commonly
// seen "BLE-serial" service UUIDs (below) and then looks for ANY writable
// characteristic among them, which is what most standalone ESC/POS-over-BLE
// web printing tools do for the same reason. If a specific printer's service
// isn't in this list, connecting will fail with a clear message — that
// printer's real UUID needs adding here once known (a BLE scanner app on the
// phone that paired it will show it).

export type BluetoothPrinterInfo = { id: string; name: string }

const KEY = 'kp:bt:printer'

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export function getBluetoothPrinter(): BluetoothPrinterInfo | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as BluetoothPrinterInfo) : null
  } catch {
    return null
  }
}

export function setBluetoothPrinter(target: BluetoothPrinterInfo | null): void {
  try {
    if (target) localStorage.setItem(KEY, JSON.stringify(target))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage unavailable — Bluetooth printing just stays off on this device.
  }
}

// Candidate "BLE-serial" service UUIDs seen across common cheap thermal
// printer modules, most to least common. Each is tried in order; the first
// with a writable characteristic wins.
const CANDIDATE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // the single most common one — many 58mm/80mm printer boards share this OEM BLE chip
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC/Microchip "transparent UART" — also widespread in printer clones
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service — some nRF52-based printer firmware
]

type Nav = Navigator & { bluetooth: Bluetooth }

async function findWritableCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic> {
  for (const serviceUuid of CANDIDATE_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceUuid)
      const chars = await service.getCharacteristics()
      const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse)
      if (writable) return writable
    } catch {
      // This device doesn't expose that service — try the next candidate.
    }
  }
  throw new Error(
    "Couldn't find a printable channel on this device. Its Bluetooth profile isn't one we recognise yet — this printer model needs its exact service UUID added.",
  )
}

/**
 * The "Connect Bluetooth Printer" action: opens the browser's native device
 * picker, pairs, confirms a writable channel exists, and remembers it for
 * future prints. Throws with a message safe to show staff directly if the
 * user cancels the picker or the device turns out not to be printable.
 */
export async function connectBluetoothPrinter(): Promise<BluetoothPrinterInfo> {
  if (!isBluetoothSupported()) {
    throw new Error('Bluetooth printing needs Chrome or Edge — this browser or device does not support it.')
  }
  const bluetooth = (navigator as Nav).bluetooth
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: CANDIDATE_SERVICES,
  })
  const server = await device.gatt?.connect()
  if (!server) throw new Error('Could not open a connection to that device.')
  await findWritableCharacteristic(server) // throws if nothing printable
  const info: BluetoothPrinterInfo = { id: device.id, name: device.name || 'Bluetooth printer' }
  setBluetoothPrinter(info)
  return info
}

/** Chrome remembers a granted device permission across page loads; this
 * reconnects to it silently (no picker) using that stored permission,
 * without ever prompting again unless it's been revoked. */
async function reconnectSilently(saved: BluetoothPrinterInfo): Promise<BluetoothRemoteGATTServer> {
  const bluetooth = (navigator as Nav).bluetooth
  const getDevices = (bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> }).getDevices
  const known = getDevices ? await getDevices() : []
  const device = known.find((d) => d.id === saved.id)
  if (!device) {
    throw new Error(`"${saved.name}" isn't available for automatic reconnection — tap Connect Bluetooth Printer again.`)
  }
  const server = await device.gatt?.connect()
  if (!server) throw new Error(`Could not reconnect to "${saved.name}". Make sure it's powered on and in range.`)
  return server
}

async function writeInChunks(char: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array): Promise<void> {
  // The default BLE ATT MTU leaves about 20 usable bytes per write; writing
  // a whole ticket in one call silently truncates on many printers.
  const CHUNK = 20
  const write = char.properties.writeWithoutResponse
    ? (b: BufferSource) => char.writeValueWithoutResponse(b)
    : (b: BufferSource) => char.writeValue(b)
  for (let i = 0; i < bytes.length; i += CHUNK) {
    await write(bytes.slice(i, i + CHUNK))
  }
}

/**
 * Try to print over Bluetooth. Returns false when this browser doesn't
 * support Web Bluetooth or no printer has been connected on this device, so
 * the caller can fall back to the print dialog. Throws only when a printer
 * *is* configured and the write failed — same contract as
 * desktop-print.ts's printKotNative.
 */
export async function printKotBluetooth(ticket: KotTicket): Promise<boolean> {
  if (!isBluetoothSupported()) return false
  const saved = getBluetoothPrinter()
  if (!saved) return false
  const server = await reconnectSilently(saved)
  const char = await findWritableCharacteristic(server)
  await writeInChunks(char, kotEscPos(ticket))
  return true
}

/** Same path as a real ticket, so a test proves the real thing works. */
export async function testPrintBluetooth(paperWidth: '58mm' | '80mm', timezone: string): Promise<boolean> {
  return printKotBluetooth({
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
