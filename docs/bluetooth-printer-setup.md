# Setting up a Bluetooth thermal printer (Windows)

End to end, from an unopened printer to tickets coming out during service.

The short version of how this works: **KhaoPiyo never talks to the printer.**
Windows does. Once the printer is a normal Windows printer, KhaoPiyo prints to
it the same way it would print to any other — which is why Bluetooth, USB and
LAN all work identically from the app's side.

That also means the whole job is really one question: **does this printer
appear under Windows Printers?** Everything below is about getting it there.

---

## 1. Pair the printer

1. Turn the printer on and hold its feed button until it enters pairing mode if
   the model requires it — check the slip that came in the box.
2. Windows → Settings → **Bluetooth & devices** → **Add device** → Bluetooth.
3. Pick the printer. It usually shows as something like `POS-58`, `BlueTooth
   Printer`, `RPP02N`, or the model number.
4. If it asks for a PIN, try **0000** or **1234** — those are the near-universal
   defaults on these units.

Pairing alone does **not** make it printable. It only creates a Bluetooth link.

---

## 2. The important check

Go to **Settings → Bluetooth & devices → Printers & scanners**.

**If the printer is listed there** — good, skip to step 4.

**If it is not listed** (it only shows under "Devices" or "Other devices"),
Windows paired it but has no print driver for it. This is the usual outcome for
cheap 58mm printers, and it is the step people get stuck on. Continue to step 3.

---

## 3. Install a driver

Windows needs a driver that can turn a page into dots for this printer.

**First try the manufacturer's driver.** Search the model number plus "Windows
driver" — most of these units ship one, often labelled "POS Printer Driver" or
"Printer Driver Setup". Install it, and when it asks for a port, choose the
outgoing **COM port** that pairing created (visible under the printer's
Bluetooth properties → Services, usually something like `COM3`).

**If there is no branded driver**, most cheap 58mm printers are rebadged and
work with a generic one — `POS58`, `XP-58`, or `Gprinter` drivers are the
common ones. Install it against the same COM port.

> **Don't use "Generic / Text Only".** It looks like the obvious choice and it
> is the wrong one here. That driver accepts plain text only, and a browser
> sends a rendered page. You get garbage or blank paper. The driver has to be a
> real graphics one for the printer.

Once installed, the printer should appear under **Printers & scanners**. Print
a Windows test page from its properties before going any further — if that
fails, the problem is the printer or the pairing, and nothing in KhaoPiyo will
fix it.

---

## 4. Set the paper size

Open the printer under **Printers & scanners** → **Printing preferences**, and
set the paper to the roll actually loaded — 58mm or 80mm.

The driver decides the physical page. KhaoPiyo's ticket layout fits inside
whatever the driver says the page is, so a wrong setting here shows up as
clipped or half-width tickets no amount of app-side fiddling will fix.

---

## 5. Add it in KhaoPiyo

**Settings → KOT printing.**

1. Turn KOT printing **on**.
2. **Add printer**:
   - **Name** — whatever staff call it. "Kitchen".
   - **Connection** — Bluetooth. This is a label for your own reference; it
     does not change how printing works.
   - **Paper width** — match what you set in step 4.
   - **Kitchen station** — leave as "All items" unless you run separate
     stations.
   - **Copies** — 1 unless the pass and the line each want one.
3. **Test print.**

Paper should come out. The test ticket includes a deliberately long line so you
can see immediately whether the width is right.

If nothing happens, the printer is not reachable from Windows — go back to
step 3. If the dialog appears and you pick the wrong printer, nothing prints
either; check the destination in the dialog.

---

## 6. Make it print by itself

**Kitchen → Auto-print on.** New orders now print as they arrive, as long as
that screen stays open.

A print dialog still appears each time. To remove it, follow
[kiosk-printing.md](kiosk-printing.md) — one desktop shortcut, one Windows
default-printer setting.

---

## When Bluetooth is the wrong answer

Worth knowing before you buy a second printer. Bluetooth is workable but it is
the weakest of the three connections:

- **One printer, one paired computer.** A second tablet cannot print to it.
- **Range is about a room.** Counter machine to kitchen printer through a wall
  is already marginal.
- **It drops when the computer sleeps**, and re-pairing after a printer power
  cycle becomes a recurring chore.

A printer with an Ethernet port on a fixed IP has none of those problems, costs
the same, and any number of devices can print to it. If you buy another
printer, buy that one.

---

## If there is genuinely no Windows driver

A few printers ship nothing usable for Windows. Then browser printing cannot
work at all — there is no driver for the browser to print through.

The fallback is a native program that writes raw ESC/POS bytes to the COM port,
which is the print bridge described in [print-bridge.md](print-bridge.md). It
is not built yet. If you hit this, say so and it can be added to the existing
desktop app rather than starting from scratch.
