# Printing KOTs without a print dialog (Windows)

By default, every ticket opens Chrome's print preview and somebody has to click
Print. That is fine for testing and hopeless during service. Chrome's
`--kiosk-printing` flag removes the dialog: the ticket goes straight to the
default printer the moment KhaoPiyo asks.

This is a one-time setup on the counter machine. Nothing in KhaoPiyo changes.

## Before the flag will help

**Set the thermal printer as the Windows default, and stop Windows moving it.**
This matters more than the flag itself: with the dialog gone, there is nothing
to catch a mistake, and every kitchen ticket will silently go to whatever is
default — an A4 printer, or "Microsoft Print to PDF", which produces no paper
and no error.

1. Settings → Bluetooth & devices → Printers & scanners.
2. Turn **off** "Let Windows manage my default printer". Leave it on and
   Windows resets the default to whatever was last used, so KOTs start coming
   out of the office printer the day somebody prints a supplier invoice.
3. Open the thermal printer → **Set as default**.
4. In the same screen open **Printing preferences** and set the paper size to
   the roll actually loaded (58mm or 80mm). The driver decides the physical
   page; KhaoPiyo's layout only fits inside it.

## The shortcut

1. Right-click the desktop → **New → Shortcut**.
2. Paste this as the location, on one line:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://khaopiyo.ventron.in/dashboard/kitchen
```

3. Name it something the staff will recognise — "Kitchen Screen".

`--app=` opens a clean window with no tabs or address bar, which is what you
want on a screen nobody should be browsing from. Drop it if you would rather
have a normal Chrome window.

On Microsoft Edge the flag is the same; only the path differs:
`"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"`.

## The one gotcha that catches everyone

**Chrome must be completely closed before you use the shortcut.** Command-line
flags are read once, when the very first Chrome process starts. If any Chrome
window is already open — including one hiding in the system tray — the shortcut
just opens a tab in the process that is already running, without the flag, and
you get the print dialog back with no explanation.

Close every Chrome window, check the system tray, then launch the shortcut.

If the counter machine also uses Chrome for other things, give that a separate
profile so the two never share a process:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --user-data-dir="C:\KhaoPiyo\ChromeKitchen" --app=https://khaopiyo.ventron.in/dashboard/kitchen
```

That directory is created on first launch and keeps its own session, so staff
stay signed in to KhaoPiyo there and nowhere else.

## Then turn auto-print on

In KhaoPiyo: **Kitchen → Auto-print on**. The setting is remembered per café on
that browser, so it survives a restart of the shortcut.

With both in place, an order placed from the QR menu or the POS prints in the
kitchen on its own, with nobody touching anything.

## Checking it works

Settings → KOT printing → **Test print**. Paper should appear with no dialog.

- **Dialog still appears** → Chrome was already running. Close everything and
  relaunch the shortcut.
- **Nothing prints at all** → the default printer is not the thermal one, or it
  is offline. Print a Windows test page first; if that fails, the problem is
  the printer or its pairing, not KhaoPiyo.
- **Prints but the layout is wrong** → the driver's paper size does not match
  the roll. Fix it in Printing preferences, not in the app.

## Starting it automatically

If the machine should come up ready for service, put the shortcut in the
startup folder: press `Win + R`, run `shell:startup`, and drop a copy in.

## What this does not do

It does not make printing reliable when the browser is closed — the Kitchen
screen has to be open for tickets to print. If you want printing that survives
a closed browser, that is the print bridge, which is not built yet. See
[print-bridge.md](print-bridge.md).
