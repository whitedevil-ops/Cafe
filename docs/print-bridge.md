# KhaoPiyo Print Bridge — integration contract

The bridge is what collects queued KOT jobs from KhaoPiyo and sends them to
thermal printers on the local network. It exists because a browser cannot
open a raw TCP socket to a printer, and because forcing a paid cloud-printing
service on a café is a cost KhaoPiyo does not want to introduce.

**Where it actually runs**: inside the existing KhaoPiyo desktop app
(`desktop/src-tauri`), as a background task started at app launch —
`src/bridge.rs`. It is not a separate program a café installs on top of
anything; it's the same `.exe`/`.msi` counters already use, polling in the
background for as long as the app process is running, independent of which
page the window shows. **v1 scope is LAN printers only** — a job for a
USB/Bluetooth-connected printer is left for the existing manual print path
(the Kitchen screen's "Print now on this device" button) rather than
attempted by the bridge; see the "Known limitation" section below for why.

**The bridge is optional. If it never runs (not paired, or the desktop app
isn't open on any café PC), ordering and the digital KDS are completely
unaffected — jobs simply sit in the queue** and staff can still print with
Reprint KOT or Print now on this device on the Kitchen screen.

## Security model

The bridge holds exactly one secret: a **bridge token**, issued from
Settings → KOT printing → "Pair a new bridge" and shown once. It's stored
locally in the desktop app's app-data directory, in a file separate from the
sign-in session — signing out at end of shift does not un-pair the printer.

It never receives:

- the Supabase URL, anon key, or service-role key
- any database credential
- any other café's data

The token maps to exactly one `cafe_id` server-side, and every query is filtered
by it. A leaked token exposes one café's kitchen tickets and cannot be used to
reach another café. Revoke it from the same settings screen; it stops working
immediately.

Tokens are stored hashed (SHA-256). A database leak does not yield working
bridges.

## Endpoints

Base URL: `https://khaopiyo.ventron.in`

### 1. Claim jobs

```
POST /api/print/poll
Content-Type: application/json

{ "token": "<bridge token>", "limit": 10 }
```

Response:

```json
{
  "cafe_id": "…",
  "jobs": [
    {
      "job_id": "…",
      "kind": "kot",
      "printer": {
        "id": "…",
        "name": "Main Kitchen Printer",
        "connection_type": "lan",
        "ip_address": "192.168.1.50",
        "port": 9100,
        "paper_width": "80mm"
      },
      "document": {
        "kot_number": "1048",
        "table_label": "T08",
        "order_type": "dine_in",
        "source": "qr",
        "placed_at": "2026-07-23T14:12:00Z",
        "timezone": "Asia/Kolkata",
        "station": "Main Kitchen",
        "paper_width": "80mm",
        "copies": 1,
        "items": [
          { "qty": 2, "name": "Veg Burger", "modifiers": ["Extra Cheese"], "note": "NO ONION" },
          { "qty": 1, "name": "Fries", "modifiers": [], "note": "LESS SALT" }
        ],
        "order_note": "No peanuts"
      }
    }
  ]
}
```

`kind` is one of `kot` | `kot_update` | `reprint` | `test`. `kot`, `reprint`,
and `test` all share the full-ticket `document` shape above (`items`,
`order_note`, etc). `kot_update` — queued when an order is edited *after* its
first KOT already printed — has a different shape: `added` and `removed`
arrays (same per-line `{qty, name, modifiers, note}` shape) instead of
`items`, representing only the delta against what was last sent to this
printer for this order. Render it visibly differently (e.g. a bordered "KOT
UPDATE" header) so it's never mistaken for a new order at a glance.

Claiming is atomic (`FOR UPDATE SKIP LOCKED`): two bridges pointed at the same
café will not both print the same ticket. A `failed` job also becomes
reclaimable automatically, up to 5 attempts, with exponential backoff — the
bridge does not need its own retry logic, just keep polling normally.

Poll every ~4 seconds. A job moves to `printing` the moment it is claimed.

### 2. Report the outcome

```
POST /api/print/report
Content-Type: application/json

{ "token": "<bridge token>", "job_id": "…", "ok": true }
```

On failure:

```json
{ "token": "…", "job_id": "…", "ok": false, "error": "Connection refused" }
```

A failure marks **only the print job** failed. The order is untouched and stays
live on the KDS. The error string surfaces in the app so staff can retry or
reprint.

Reporting also updates the printer's `last_seen_at`, which drives the
"Printer offline" banner on the kitchen screen and the Settings → KOT
printing → Print history panel.

## Rendering

`document` deliberately contains **no ESC/POS bytes and no layout**. It says
what to print; the bridge decides how (see `desktop/src-tauri/src/escpos.rs`
for the current implementation — `render()` for a full ticket, `render_update()`
for a `kot_update` delta). That is what allows a second printer brand to be
supported by extending the bridge alone, with no schema or API change.

Rules:

- The order type and table number (or TAKEAWAY/DELIVERY) should be the
  largest, boldest thing on the ticket — a cook reads it at arm's length in
  poor light, before reading anything else.
- Item quantity is the loudest part of each item line; modifiers and
  per-item notes are visually subordinate but still clearly separated from
  each other.
- `order_note` gets its own visually distinct block (e.g. a bordered "★
  KITCHEN NOTE" callout) — never just an uppercased line blended into the
  rest of the ticket.
- Format `placed_at` using the supplied `timezone`. Do not use the computer's
  local zone.
- Never print prices, taxes or totals. A KOT is a kitchen instruction, not a
  bill.
- `copies` is the number of identical tickets to emit.
- A `kot_number` of `TEST` is a test page triggered from Settings → KOT
  printing → Test print, which now genuinely goes through this same queue
  and bridge (not a browser print dialog) — so a passing test print proves
  the real path works.

## Known limitation: serial/USB printers aren't covered by the bridge yet

A bridge token is scoped to a *café*, not to a specific machine. If a café
runs the desktop app on two counters, both paired, both compete for the same
job queue. For a LAN printer that's harmless — either machine can reach it
over the network. For a printer wired directly into one specific PC (USB) or
paired to one specific PC's Bluetooth radio, the wrong machine claiming that
job just fails permanently — it has no way to reach that printer. Until the
claim can be scoped per-machine (a `p_printer_ids` filter on
`bridge_claim_jobs`, plus a per-machine printer-target file the desktop app
already has the plumbing for in `printing.rs`/`bridge.rs`), USB/Bluetooth
printers stay on the existing manual path (Kitchen screen → Print now on
this device), unaffected and unregressed by any of this. Moving to a LAN/
Wi-Fi printer is the direction this already pushes a café toward regardless.
