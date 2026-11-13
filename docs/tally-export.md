# Exporting GST sales to Tally

**Where:** Dashboard → Reports → GST → **Export to Tally** (same plan as the GST
report). It writes a TallyPrime voucher-import file (XML) for the *finished* days
in the selected range.

**Status: first version, not yet imported into a real Tally.** The numbers and the
file structure are tested (`tests/unit/tally-export.test.ts`, and an end-to-end
check against the live report on a throwaway café). That Tally *accepts* every tag
is the one thing that has not been proven — see "Try it safely" below.

## What the file contains

For each finished business day, in the café's own timezone:

| Voucher | Debit | Credit |
|---|---|---|
| **Sales** `KP-GST-YYYYMMDD` (one per day) | Party ledger — the day's taxable value + CGST + SGST | One sales ledger **per GST rate** (taxable value), the CGST ledger, the SGST ledger |
| **Credit Note** `<credit note number>` (one per refund) | Sales-returns ledger (taxable) + CGST + SGST | Party ledger |

Every voucher balances exactly: the party amount is the sum of the other entries in
whole paise, never a separate figure. Consequences worth knowing:

- A bill's own round-off is **not** exported, so a day can differ from the printed
  invoice totals by a rupee or two.
- CGST and SGST can differ by a rupee on an odd tax amount (₹99 → 49 + 50). That is
  how the report already splits it.
- **Today is never included.** A voucher for a day still open would be wrong by
  closing time. Export it tomorrow.

## What it does not contain (yet)

- **Receipts by cash / UPI / card.** The party ledger therefore carries each day's
  receivable until receipts are booked in Tally.
- Expenses, purchases, stock, wallet movements.
- Per-bill vouchers or customer GSTINs (B2B). Everything is a counter-sales summary.
- **Credit notes on mixed-rate orders** are split by the order's overall tax ratio, not
  per rate (the GST report says the same). They post to one sales-returns ledger.

## Setting it up

1. In Tally, create (or note the exact names of) these ledgers: a **party** ledger for
   counter sales, a **sales ledger per GST rate** the café charges, **Output CGST**,
   **Output SGST**, and **Sales Returns**.
2. In the panel, type each name **exactly** as Tally has it — spelling, capitals and
   spaces. A single wrong letter or a trailing space is the most common cause of
   "Ledger … does not exist". Names are remembered per café, on that device.
3. Optionally type the Tally company name. Blank = the file imports into whichever
   company is open, so make sure the right one is.

## Importing

TallyPrime: **Gateway of Tally → Import → Vouchers** (menu names vary by release),
choose the downloaded `.xml`. Tally reports how many vouchers were created and how
many had errors; details are in its import log (`Tally.imp`).

**Compare before you trust it.** The panel shows the file's taxable value, CGST and SGST
and the refunds. They should equal the GST report on screen for the same days.

## Importing the same day twice

Vouchers have a stable number (`KP-GST-20261110`), but Tally will still create a
**duplicate** unless it is told not to. Turn on Tally's *Prevent Duplicates* for the
Sales and Credit Note voucher types, or only import each day once. If a day must be
redone, delete that day's voucher in Tally first.

## Errors you may see, and why

| Tally says / you see | Cause |
|---|---|
| Ledger "…" does not exist | Name in the panel ≠ name in Tally (case, spelling, trailing space), or the ledger was never created |
| Voucher totals do not match | Should be impossible from this file (it balances by construction). If it appears, the file was edited or a ledger has auto-calculation turned on |
| Date out of range / outside financial year | The vouchers are dated outside the company's books period |
| GST calculated differently than the file | The sales ledger in Tally carries its own GST rate or "calculate on" setting that conflicts with the explicit CGST/SGST lines. Ask the accountant to set the ledgers to "not applicable" for GST calculation, or to adjust |
| Nothing imported / import refused | Wrong company open, or the file was saved with a different encoding. The file is UTF-8 |
| "no GST invoice" / panel says the café isn't GST-registered | Café profile → Business & GST must be on, with a GSTIN |

The panel itself refuses, with a plain message, when a GST rate in the range has no
ledger typed for it, when a name is blank, or when the range is wider than 92 days.

## Try it safely

1. Ask the accountant to create a **sample company** (or a copy) in Tally.
2. Export **one finished day** and import it there.
3. Open the Sales voucher in Tally and check: party debited, sales per rate and CGST/SGST
   credited, narration shows the invoice range. Then the credit note, if any.
4. Even better: have the accountant **export one real Sales voucher as XML from their own
   Tally** and send it. The tags in this file should match it; if they differ, the
   difference is the fix.

Only then import real books.

## For developers

- `lib/tally-export.ts` — pure builder (`buildTallyXml`, `closedBusinessDays`). No I/O.
- `app/dashboard/reports/gst/tally-export-panel.tsx` — the panel. One report RPC per day,
  from the browser straight to the database, so exporting a month costs the hosting plan
  nothing.
- Unverified against a real Tally: the exact tag set and sign convention for a GST sales
  voucher (debit = `ISDEEMEDPOSITIVE` Yes with a **negative** amount), GUID/duplicate
  behaviour, and whether a company must be open. Research notes live in the project
  memory (`cafe-tally-integration-research`).
- A later version can POST the same XML to Tally's local HTTP server (port 9000) from the
  desktop app instead of downloading a file.
