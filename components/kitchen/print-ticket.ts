import { kotHtml, type KotTicket } from '@/lib/kot-print'
import { printKotNative } from '@/lib/desktop-print'

/**
 * Print a kitchen ticket through the browser's own print path.
 *
 * A hidden iframe rather than window.open: a popup is blocked unless it comes
 * straight off a click, which rules out ever auto-printing an incoming order,
 * and it would also steal focus from the KDS mid-service. The iframe prints
 * the same document without either problem.
 *
 * Resolves once the dialog has been handed off. It cannot report whether paper
 * actually came out — the browser is not told — so callers must not claim a
 * ticket printed, only that it was sent.
 */
export async function printKot(ticket: KotTicket): Promise<void> {
  // The desktop app can write to the printer directly, with no dialog and no
  // driver. It returns false when this is a browser, or when nobody has picked
  // a printer on this machine yet, and only then do we fall back to the print
  // dialog below. A configured-but-failing printer throws instead, because
  // "your printer is unplugged" must not turn into an unexpected dialog.
  if (await printKotNative(ticket)) return
  return printViaDialog(ticket)
}

function printViaDialog(ticket: KotTicket): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    // Off-screen rather than display:none — a hidden frame has no layout in
    // some engines, and an unlaid-out document prints blank.
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(frame)

    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      // Deferred: removing the frame while its print dialog is still open
      // cancels the job in Chrome.
      window.setTimeout(() => frame.remove(), 1000)
      resolve()
    }

    frame.onload = () => {
      try {
        const win = frame.contentWindow
        if (!win) return cleanup()
        win.focus()
        win.print()
      } catch {
        // Blocked or unsupported — the caller still gets a resolved promise
        // and reports nothing more than "sent".
      }
      cleanup()
    }

    const doc = frame.contentDocument
    if (!doc) return cleanup()
    doc.open()
    doc.write(kotHtml(ticket))
    doc.close()
  })
}
