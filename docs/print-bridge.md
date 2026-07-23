# KhaoPiyo Print Bridge — integration contract

The bridge is a small program that runs on the café's own Windows computer. It
collects queued KOT jobs from KhaoPiyo and sends them to thermal printers on the
local network. It exists because a browser cannot open a raw TCP socket to a
printer, and because forcing a paid cloud-printing service on a café is a cost
KhaoPiyo does not want to introduce.

**The bridge is optional. If it never runs, ordering and the digital KDS are
completely unaffected — jobs simply sit in the queue.**

## Security model

The bridge holds exactly one secret: a **bridge token**, issued from
Settings → Kitchen → KOT printing and shown once.

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

Claiming is atomic (`FOR UPDATE SKIP LOCKED`): two bridges pointed at the same
café will not both print the same ticket.

Poll every 2–3 seconds. A job moves to `printing` the moment it is claimed.

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
"Printer offline" banner on the kitchen screen.

## Rendering

`document` deliberately contains **no ESC/POS bytes and no layout**. It says
what to print; the bridge decides how. That is what allows a second printer
brand to be supported by updating the bridge alone, with no schema or API
change.

Suggested layout, 80mm:

```
        KHAOPIYO KOT

KOT #1048                    (large)
Table: T08
Time: 7:42 PM
Source: QR
Station: Main Kitchen
--------------------------------
2 x Veg Burger               (large)
    + Extra Cheese
    NO ONION

1 x Fries                    (large)
    LESS SALT
--------------------------------
Special Note:
No peanuts
```

Rules:

- Order number, item names and quantities should be the largest text on the
  ticket. A cook reads it at arm's length in poor light.
- Format `placed_at` using the supplied `timezone`. Do not use the computer's
  local zone.
- Never print prices, taxes or totals. A KOT is a kitchen instruction, not a
  bill.
- `copies` is the number of identical tickets to emit.
- A `kot_number` of `TEST` is a test page triggered from settings.

## What I still need from you to finish this

The generic layer above is complete and printer-agnostic. To write the bridge's
actual output stage, I need to know:

1. **Printer make and model** (e.g. Epson TM-T82, TVS RP 3230, Rugtek RP80).
   ESC/POS is broadly standard but cut commands, codepages and logo handling
   differ per vendor.
2. **Connection** — LAN (most reliable; needs a static IP on the printer), or
   USB into the café's PC.
3. **Paper width actually in use** — 80mm is typical for kitchens, 58mm for
   handheld/counter rolls.
4. **Whether the café PC is always on during service.** If it sleeps, jobs queue
   until it wakes — which is safe, but staff should know that is the behaviour.

I have deliberately not guessed at these. Hardcoding one vendor's byte
sequences before knowing the hardware is how printer integrations become
unmaintainable.
