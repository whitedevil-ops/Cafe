# KhaoPiyo — Real Café Pilot Checklist

This is a step-by-step script for running KhaoPiyo at one real café with real
customers, on real hardware, before trusting it with a full day of service.
It is written to be followed literally, device by device. Nothing on this
list has been executed by an automated agent — every checkbox is a manual
action a human needs to perform and confirm.

**Read this first — known gaps for a first pilot:**
- No SMS provider is configured. Customer OTP login and SMS bill delivery
  will not work until MSG91 or Twilio credentials are added. Skip "My
  Orders" phone verification and SMS receipts for this pilot; the printed/
  shown receipt link (`/r/<token>`) still works with no SMS involved.
- No physical KOT printer bridge program exists yet (only the schema, queue,
  and pairing UI do). The kitchen must run on the digital KDS screen only —
  do not promise the café a paper ticket printer for this pilot.
- No GST-formatted tax invoice exists yet (Phase 2, not started). The
  receipt page shows subtotal/discount/tax/total correctly but is not a
  statutory GST invoice. Fine for a pilot; say so if the café asks.

---

## 0. Before the café opens (one-time setup)

1. **Owner account** — sign up at `/signup` with the owner's real email and
   phone. Confirm the email if email confirmation is required.
2. **Café profile** (`/onboarding` → `/dashboard/settings`) — enter the real
   café name, address, phone, GSTIN (if registered), and **timezone**
   (should be `Asia/Kolkata` for an Indian café — double-check, since every
   bill time and daily order-number reset depends on this field).
3. **Tax rate** — set `tax_percent` to the café's actual applicable rate.
   Confirm `service_charge` matches what the café actually charges (0 if
   none).
4. **Menu** (`/dashboard/menu`) — add every item the café actually sells,
   with real prices. Add variants (size) and add-ons only where the café
   genuinely offers them — an extra tap per order for an option nobody asks
   for is a real cost during a busy shift.
5. **Tables** (`/dashboard/tables` → table manager) — create one row per
   physical table with the label printed/painted on that table (e.g. "T5",
   not "Table 5") so a customer glancing at the QR sticker and the table
   number can tell they match.
6. **Print the QR codes** — each table gets its own QR pointing at
   `/t/<token>`. Stick it where a seated customer can scan it without
   standing up. Physically check a handful of printed codes with a phone
   camera before going live — a QR that's too small, too glossy, or cut off
   at the edge is a real failure mode.
7. **Staff accounts** — invite each real staff member
   (`/dashboard/settings` → staff invites) with the role they'll actually
   use (cashier, manager, kitchen, waiter). Have each person actually accept
   their invite and log in once before day one, on the device they'll use.
8. **Decide: cash management on or off** (`/dashboard/settings` → Cash
   management toggle). Turn it ON only if the café genuinely reconciles a
   cash drawer at shift end. If most business is card/UPI, leave it off —
   nothing else in the app changes either way.
9. **Decide: KOT printing** — leave off for this pilot (no bridge program
   exists yet). The kitchen screen is the source of truth for tickets.
10. **Assign a device per role** (see §1) and confirm each device can reach
    the internet and load the site before the café opens.

---

## 1. Device-by-device role assignment

| Role | Device | URL | Login needed? |
|---|---|---|---|
| Customer | their own phone | `/t/<table-token>` (via QR) | No |
| Cashier / counter staff | tablet or phone at the counter | `/dashboard/pos` | Yes (staff account) |
| Kitchen | a tablet left running in the kitchen | `/kds/<cafe-slug>` | No (station display, not staff login) |
| Kitchen (with cancel/refund powers) | staff phone | `/dashboard/kitchen` | Yes (staff account) |
| Waiter | staff phone | `/dashboard/tables` | Yes (staff account) |
| Owner / manager | phone or laptop | `/dashboard` | Yes (owner/manager account) |

Confirm the kitchen tablet is logged out / on the plain `/kds/<slug>` screen,
not left on an authenticated staff session — that screen is meant to stay up
all day without anyone touching it.

---

## 2. Multi-device dry run (do this BEFORE the first real customer)

Do this with two or three staff members physically present, each on their
assigned device, at a quiet moment before doors open.

1. **Place a real order** — scan a real table's QR on a real phone. Add an
   item with a variant and an add-on, add a note ("no onions" or similar),
   place the order with a real phone number.
2. **Confirm it reaches the kitchen** — within a few seconds, the same order
   should appear on the `/kds/<slug>` tablet with the item, variant, add-on,
   and note all visible and correctly worded.
3. **Confirm the kitchen can progress it** — mark it preparing, then ready,
   from whichever screen the kitchen staff will actually use.
4. **Confirm the floor view updates** — `/dashboard/tables` should show the
   table occupied, then reflect the order status change.
5. **Call the waiter** — from the customer's phone, tap "Call waiter." Confirm
   a staff device sees the notification.
6. **Request the bill** — from the customer's phone, tap "Request bill."
   Confirm it shows up as bill-requested on the floor view.
7. **Settle the order** — from the POS or the tables drawer, mark the order
   paid with a real payment method.
8. **Open the receipt link** — visit `/r/<receipt-token>` (from the order's
   confirmation screen) and confirm the total, tax, and item list match what
   was actually ordered and paid.
9. **Confirm it appears on the owner dashboard** — `/dashboard` should show
   the order in today's revenue and order count within the next poll cycle
   (≤30 seconds).
10. **If cash management is on** — open a shift, record the test sale,
    close the shift, and confirm the closing count matches what's actually
    in the drawer (it should, since only a real cash payment was taken).

If any of steps 1–10 doesn't behave as described, stop and fix it before
letting a real customer touch the QR code — do not "note it for later."

---

## 3. Adversarial checks (staff should try to break it once)

1. **Scan an old / wrong QR** — print or reuse a QR from a table that
   doesn't exist and confirm the customer sees a clear error, not a blank
   page or a crash.
2. **Try to order an item with no variant selected** where a variant is
   required — confirm the app blocks it with a clear message rather than
   silently mispricing the order.
3. **Two staff try to close the same shift / settle the same order at the
   same time** — confirm the second attempt fails cleanly instead of
   double-charging or double-closing.
4. **Turn off wifi on the customer's phone mid-order** — confirm the app
   tells the customer something went wrong rather than silently losing the
   order (see §5 for what to do if this actually happens during service).

---

## 4. First real service day

**Opening:**
- [ ] Confirm every staff member on shift can log into their assigned
      device.
- [ ] If cash management is on, open the shift with an accurate float count.
- [ ] Do one real test order end-to-end (§2, abbreviated) before the doors
      open, using a staff member's own phone as the "customer."

**During service:**
- [ ] Owner or manager keeps `/dashboard` open (or checks it every hour) and
      watches the "Needs attention" panel — late kitchen tickets, tables
      waiting for the bill, cash discrepancies (if cash management is on).
- [ ] Kitchen staff treat the KDS tablet as the single source of truth for
      what to cook next — no verbal double-checking against a paper pad.

**Closing:**
- [ ] Settle every open order — nothing should be left "placed" or
      "preparing" at close.
- [ ] If cash management is on, close the shift and record the actual
      counted cash. If it doesn't match the expected amount, use the
      discrepancy reason field honestly — that field existing is the whole
      point.
- [ ] Owner reviews the day's revenue, order count, and any cancellations on
      `/dashboard` against their own memory of the day — flag anything that
      looks wrong.

---

## 5. If something breaks mid-service

1. Do not panic-restart anything customers are actively using.
2. Capture: the order's short code, the approximate time, and a screenshot
   of whatever looked wrong.
3. Fall back to the café's existing manual process (paper order pad, manual
   bill) for that specific table only — don't stop the whole café's use of
   the app over one incident.
4. Report the captured details so the root cause can be found from real
   data, not a secondhand description.

---

## 6. Sign-off

Pilot is ready to go live with real, unwarned customers only when:
- [ ] Every checkbox in §0 is done.
- [ ] The dry run in §2 passed on real devices, not just in review.
- [ ] The adversarial checks in §3 behaved safely.
- [ ] At least one staff member on each role (cashier, kitchen, waiter,
      owner) has used their assigned device once and didn't get stuck.
