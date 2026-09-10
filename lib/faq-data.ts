import type { Faq } from '@/lib/seo'

// Generated content (full-site SEO/AEO/GEO audit, 2026-09-10) — 100 FAQs
// across 10 topic clusters, each independently written to cover a distinct
// search intent rather than being variations on the same question. Kept as
// data separate from app/(marketing)/faq/page.tsx the same way lib/blog.ts
// is kept separate from its renderer.

export type FaqCategory = {
  category: string
  faqs: Faq[]
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    "category": "Restaurant & café POS basics",
    "faqs": [
      {
        "q": "What exactly does a restaurant POS system do, in plain terms?",
        "a": "A restaurant POS (point of sale) is the software your staff use to take an order, send it straight to the kitchen, work out the bill with GST, and record the payment — all from one screen instead of an order pad, a calculator, and a cash book kept separately. Most modern systems go further than just billing: they also track your menu, staff logins, and daily sales so you're not tallying receipts by hand at closing time. KhaoPiyo, for instance, puts ordering, a kitchen display, GST invoicing, and daily reports on one screen a cashier or waiter can run from whatever phone, tablet, or laptop the café already has."
      },
      {
        "q": "What's the real difference between a POS system and a cash register or handwritten billing register?",
        "a": "A cash register or bill book only records what was paid — it has no idea what's on your menu, what GST rate applies to which item, or what's happening in the kitchen right now. A POS connects the order, the kitchen, and the bill, so the invoice is generated from what was actually ordered instead of typed out by hand each time, and every sale becomes a searchable record rather than a loose paper slip. That gap shows up most at month-end, when totaling a stack of carbon-copy bills for GST filing takes hours that a POS report gives you in seconds."
      },
      {
        "q": "What's the difference between a cloud-based POS and a traditional on-premise POS?",
        "a": "An on-premise POS keeps your data on a machine physically sitting in your café — if that machine's hard disk fails, your billing history can go with it, and you're generally stuck using that one terminal. A cloud POS runs in a browser and stores data on remote servers instead, so you can log in from any device and your sales records survive a terminal breaking down or getting replaced. The trade-off is that a cloud system, KhaoPiyo included, needs an internet connection to bill — it isn't built to run fully offline."
      },
      {
        "q": "Does a cloud kitchen with no dine-in seating need the same kind of POS as a sit-down café?",
        "a": "Mostly yes, but a cloud kitchen leans on a smaller part of the system — order intake, kitchen display, and billing — since there's no table management or tableside service to run. What it still needs is the same core: the order reaching the kitchen correctly, a GST-compliant bill, and clean sales records for daily reconciliation. One thing to know if you're evaluating KhaoPiyo specifically for a cloud kitchen: it doesn't connect to food-aggregator apps today, so it's built for orders placed directly — at a counter, through its own QR ordering, or entered by staff — not orders arriving from an aggregator."
      },
      {
        "q": "I run a small tea stall or single-counter shop — do I actually need POS software, or is manual billing enough?",
        "a": "For a handful of items sold mostly in cash, a manual register can get by for a while. It starts to strain once GST needs calculating correctly per item, you have staff you can't personally watch at every transaction, or you just want to stop recalling prices from memory — small errors and unrecorded cash creep in over time. A basic POS plan removes most of that: the bill and tax are calculated automatically and every sale is logged, so the real question is how many transactions and staff you're managing, not how small the shop is."
      },
      {
        "q": "What is a KOT (Kitchen Order Ticket), and why does it matter?",
        "a": "A KOT is the ticket that tells the kitchen exactly what to cook — item, quantity, table or order number, and notes like 'no onion' — kept separate from the customer's final bill. Traditionally it's a handwritten or printed slip a waiter physically carries to the kitchen; in a POS system it's generated the moment the order is placed, so the kitchen sees it immediately without anyone walking it over. It matters because it's the single source of truth for what to cook — lose it or get it wrong, and you get missed items, wrong dishes, or orders cooked twice."
      },
      {
        "q": "What does 'cloud POS' actually mean, and where does my restaurant's data get stored?",
        "a": "'Cloud' means the software and your data live on remote servers rather than on a computer sitting behind your counter — you access it through a browser on whatever device you have, and the provider keeps those servers running and backed up. Practically, it means your sales history, menu, and customer records aren't tied to one physical machine that could crash, get stolen, or simply age out. The one requirement is an internet connection to bill, since nothing runs purely locally on your counter machine."
      },
      {
        "q": "Is restaurant POS software the same thing as accounting software?",
        "a": "No. A POS handles the front end of a sale — taking the order, billing it, applying GST, and recording the payment the moment it happens. Accounting software (or your CA using one) works with the output of that: profit and loss, balance sheets, and tax filing across your whole business, not just food sales. A good POS makes accounting easier by handing over clean, itemized GST reports, but it doesn't replace bookkeeping or a chartered accountant."
      },
      {
        "q": "How does an order actually move through a POS system, from the table to the final bill?",
        "a": "A waiter enters the order, or a customer places it themselves through QR ordering, and it appears on the kitchen display or as a printed KOT right away — nobody has to physically walk it to the kitchen. Once it's cooked and served, the same order becomes the bill: items, quantities and GST are already filled in, so the cashier is only applying a discount if needed and taking payment, not retyping anything. In KhaoPiyo that whole path — order, kitchen display, live table status, and the bill — updates in real time, so the counter always matches what the kitchen is actually working on."
      },
      {
        "q": "What's the difference between a full POS system and just putting a UPI QR sticker on the counter?",
        "a": "A static UPI QR code only collects payment — it doesn't know what was ordered, can't work out GST per item, and leaves you with nothing but a bank statement to reconstruct what actually sold. A POS captures the order first, calculates the bill and tax from it, and only then takes payment — via UPI or otherwise — so you end up with an itemized, GST-compliant invoice and usable sales data instead of just a running balance. For anything past a couple of items on the menu, that difference shows up fast at tax-filing time."
      }
    ]
  },
  {
    "category": "GST billing & tax invoicing",
    "faqs": [
      {
        "q": "What details must appear on a restaurant's GST invoice?",
        "a": "A GST-compliant restaurant invoice needs the outlet's name, address and GSTIN, a unique invoice number and date, an itemised list of food and drinks with quantity and price, the taxable value, and the GST amount split as CGST and SGST, ending in the final total. Missing the GSTIN or getting the tax split wrong is one of the more common reasons a restaurant bill gets questioned during a GST review. On KhaoPiyo, every bill already carries these fields as part of GST invoicing, whether the sale started at the counter, came in through QR ordering, or was taken by a waiter tableside — nothing needs to be filled in separately."
      },
      {
        "q": "What is the difference between CGST and SGST on a food bill?",
        "a": "CGST (Central GST) and SGST (State GST) are the two halves of the GST charged on a sale within the same state — if a café's GST rate is 5%, that usually splits as 2.5% CGST and 2.5% SGST, going to the central and state governments respectively. They're always charged together on a normal dine-in or takeaway bill and add up to the same total the customer pays either way. A sale to a customer in a different state would instead attract IGST as one combined tax, but that's rare for a café's day-to-day billing."
      },
      {
        "q": "Do restaurants need to put HSN or SAC codes on their bills?",
        "a": "Restaurant sales are classified under an SAC (Services Accounting Code), not an HSN code, because serving prepared food to a customer is treated as a service under GST law, even though the bill lists individual food items. Whether the code has to be printed on the invoice, and how many digits of it, depends on the café's annual turnover, and that threshold has changed over time. It's worth confirming the current requirement with your CA rather than guessing, since an inconsistent or missing code is an easy thing for a GST officer to flag on review."
      },
      {
        "q": "Does a restaurant's GST invoice number have to be sequential?",
        "a": "Yes — GST law requires invoice numbers to run consecutively with no gaps and no repeats within a financial year, though you're allowed to start a fresh series, or change the prefix, at the start of a new financial year. This is where manual billing usually breaks down: a skipped number, a duplicate, or a torn/voided bill that never gets accounted for all look like red flags in a GST review. Software that assigns the invoice number automatically on every bill removes this risk, which is one of the quieter reasons cafés move off handwritten books or spreadsheets."
      },
      {
        "q": "Is GST charged before or after a discount on a food bill?",
        "a": "GST applies to the value after the discount, not the original price — so a ₹500 item with a ₹50 discount is taxed on ₹450, not ₹500. This only works cleanly if the discount is shown on the invoice at the time of billing; a discount or cashback applied after the invoice is generated generally can't be used to reduce the taxable value retroactively. On KhaoPiyo, discounts are applied at the billing screen before the invoice is generated, so the invoice already reflects the correct discounted taxable value rather than needing a manual adjustment."
      },
      {
        "q": "What GST-related reports does a café need for filing returns?",
        "a": "At minimum, you need a sales register listing every invoice with its taxable value and CGST/SGST breakup, plus a summary of total tax collected for the filing period, whether that's monthly or quarterly. Most small cafés hand this over to a CA or accountant to actually file, but the underlying data — every bill correctly taxed, numbered and dated — has to be complete and accurate going in. KhaoPiyo's Scale plan includes a dedicated GST Register report that consolidates this for a chosen period, meant to save the manual export-and-tally work before a filing deadline."
      },
      {
        "q": "What happens if I bill a customer without charging GST by mistake?",
        "a": "The tax is still legally owed on that sale even if it wasn't charged — the restaurant ends up paying it out of its own margin when filing returns, since it can no longer be collected from a customer who has already left. This tends to happen with manual billing, or when staff create an ad-hoc bill outside the normal system under pressure during a rush. Billing software that applies the café's GST rate automatically to every sale, with no manual way to skip it, removes this as a possibility rather than relying on staff to remember it every time."
      },
      {
        "q": "Does a small café or cloud kitchen need to register for GST?",
        "a": "GST registration generally becomes mandatory once a business crosses the applicable annual turnover threshold, though the exact limit can vary by state and category, so it's worth confirming your number with a CA rather than assuming. Below that threshold, registration is usually optional, though some cafés register anyway because certain platforms or corporate clients expect a GST invoice, or because they expect to cross the threshold soon anyway. Once registered, GST invoicing applies to every bill you raise — there's no minimum order value below which it can be skipped for a registered business."
      },
      {
        "q": "Should a restaurant choose the GST composition scheme or regular GST?",
        "a": "Composition scheme is a simplified, flat-rate GST option available to businesses below a certain turnover, meant to cut down on paperwork — but you can't show GST separately on the bill under it (the tax is absorbed into your price instead), and you generally lose the ability to claim input tax credit on purchases like ingredients and equipment. Most cafés that plan to grow, buy heavily from GST-registered suppliers, or want that input credit stay on regular GST instead. This is genuinely a numbers-driven decision that's worth working through with a CA rather than deciding on the label alone."
      },
      {
        "q": "Can I edit or cancel a GST invoice after it's already been generated?",
        "a": "Once a GST tax invoice is issued, it isn't meant to be edited directly — corrections go through a credit note (to reduce or reverse a charge) or a debit note (to add one), both of which get their own reference and show up in your GST filing rather than silently altering the original bill. This is why most billing software either blocks editing a finalised invoice or creates a linked adjustment instead of overwriting it. If an order needs to be reversed the same day — wrong item, a walkout — it's cleaner to cancel it before the invoice is generated rather than after."
      }
    ]
  },
  {
    "category": "QR ordering & digital menus",
    "faqs": [
      {
        "q": "Is a \"digital menu\" the same as \"QR ordering\", or are they different things?",
        "a": "A digital menu is the online version of your printed menu, a guest scans, browses items, sees prices and photos, but still needs to tell a waiter or walk up to the counter to actually order. QR ordering goes further: the guest places the order directly from their phone and it reaches the kitchen without anyone re-entering it. KhaoPiyo bundles both as one feature, QR Ordering & Digital Menu, included on every plan, so scanning takes a guest from browsing straight to ordering in one flow instead of two separate steps."
      },
      {
        "q": "How do I mark a dish as sold out so guests can't order it from the QR menu?",
        "a": "You mark the item out of stock in your dashboard, and it comes off the live menu on every phone scanning it from that point on, no reprinting, no manual \"sorry, we're out\" from a waiter at every table. This is different from deleting the item outright, so its price, description and photo stay saved for whenever you're restocked and want to switch it back on. It applies instantly because the menu runs on real-time sync."
      },
      {
        "q": "Can I change menu prices or add a new dish without reprinting my QR code?",
        "a": "Yes, this is the main point of a QR-based digital menu over a laminated one, you edit the price, description or availability of any item in your dashboard and it shows up on the exact same QR code guests already have, no new code to print or paste over the table. A price hike during festival season or dropping an item that stopped selling doesn't cost you a rupee in reprinting. It's part of QR Ordering & Digital Menu on every KhaoPiyo plan, not a paid add-on."
      },
      {
        "q": "How do I get my existing café menu onto a QR ordering system, do I have to redesign it?",
        "a": "You just enter your existing items, categories, prices, and photos if you want them, into the system, there's no need to redesign your printed menu or bring in a designer. With KhaoPiyo, sign-up is free and you can build your full menu and start billing with it before choosing a paid plan, so you can see your actual menu working before spending anything. Most owners get through their whole item list in an afternoon since it's mostly re-typing what's already on their laminated menu."
      },
      {
        "q": "Should my QR menu be in Hindi as well as English?",
        "a": "In most Indian towns and smaller cities, a menu that's English-only loses a chunk of first-time or older customers, who either ask a waiter to translate (defeating the point of QR ordering) or just order something safe instead of what they'd actually enjoy. A practical middle ground is keeping dish names as-is, don't translate \"Cold Coffee\", but adding a short Hindi description under anything unfamiliar. Watch what your actual regulars struggle with rather than guessing from your own comfort with English."
      },
      {
        "q": "How do I mark veg, non-veg or Jain items clearly on a QR digital menu?",
        "a": "Since you write each item's name and description yourself, the simplest fix is to tag it directly, \"Veg\" or a green-dot symbol in the name, \"Jain, no onion-garlic\" in the description, rather than assuming a filter exists to do it for you. Many café owners just split the menu into separate Veg and Non-Veg categories instead of relying on icons alone, since that's harder to miss on a small phone screen during a busy dinner rush. Whatever method you choose, keep it consistent across the entire menu so guests aren't guessing item by item."
      },
      {
        "q": "What happens if two guests order the last plate of something at the same time through QR ordering?",
        "a": "Real-time sync means an item disappears from the menu on every phone the moment it's marked out of stock, but there's a small window before that update where a second guest could already be mid-order for the same dish. When that happens, treat it exactly like a printed menu overselling a dish, call the table, offer a swap or comp something small, it's a stock-timing issue, not a system fault. Marking items out as soon as the kitchen flags them, rather than waiting till service slows down, keeps that window as small as possible."
      },
      {
        "q": "Should I put photos on every item in my QR menu, or keep it text-only?",
        "a": "Photos help most for dishes a guest doesn't already have a picture of in their head, a specific pasta, a new mocktail, a dessert with an unfamiliar name, and help far less for things like \"Masala Chai\" or \"Veg Sandwich\" that everyone already knows. A menu where every single item has a photo tends to load slower and feel cluttered on a phone at a two-person table waiting to order. A reasonable middle ground is photographing the 15-20% of items that actually need selling, and judging it by whether it changes what people order, not by how it looks scrolling on your own phone."
      },
      {
        "q": "Can I control which items show up first on my QR digital menu?",
        "a": "Yes, you control the order categories and items appear in, so a chef's special, a high-margin dish, or something you're trying to push can sit at the top instead of getting buried under alphabetical order. This is the same logic printed menus have used for decades, top-of-page and top-of-category placement gets ordered more, except on a digital menu you can rearrange it in minutes and it goes live for every table at once. Most owners adjust this over the first couple of weeks rather than getting it perfect on day one."
      },
      {
        "q": "If I run more than one café location, does each one get its own menu on the same QR ordering system?",
        "a": "Yes, each café location keeps its own menu, items, prices, descriptions, and sold-out status are all set per outlet rather than shared across your whole business. That matters if your two locations charge slightly different prices, one serves a dish the other doesn't, or an item is out of stock at one branch but not the other. On KhaoPiyo's Growth plan (up to 2 cafés) and Scale plan (up to 6 cafés), each café you run gets its own live menu and its own QR codes."
      }
    ]
  },
  {
    "category": "Kitchen display systems & KOT",
    "faqs": [
      {
        "q": "Is a kitchen display system worth it for a small café with just one or two cooks?",
        "a": "If your kitchen is one cook working off a single counter, the ticket-routing benefit of a KDS matters less — a clear paper KOT can work fine there too. Where it still helps even in a one-cook setup is accuracy: an order shown exactly as it was entered (table number, add-ons, any notes from a QR order) removes the handwriting and \"which table was this again\" guesswork. On KhaoPiyo specifically, the Kitchen Display System is included on every plan including Starter at ₹999/month, so it costs nothing extra to run alongside your existing workflow before deciding if it actually changes anything for you."
      },
      {
        "q": "Why use a kitchen display screen instead of just printing paper KOTs?",
        "a": "The difference shows up most clearly when an order changes. If a customer cancels an item or a waiter edits a QR order after it's already gone to the kitchen, a paper KOT needs someone to walk over and cross it out, while a screen updates the same ticket in place. It also removes paper and ribbon as a running cost, and there's no soggy or lost slip sitting under a chopping board during a Saturday rush. That said, some kitchens genuinely prefer a printed ticket they can pin up and tick off by hand — which is why a café doesn't have to choose only one; a thermal printer stays optional alongside the screen."
      },
      {
        "q": "How does a kitchen display system help in a kitchen with multiple stations like grill, tandoor and beverages?",
        "a": "The problem paper tickets create in a multi-station kitchen is duplication — someone has to write or copy the same KOT for the grill, the tandoor and the beverage counter, and if one copy goes missing, that item just doesn't get made. A shared screen means everyone working on the same order sees the same live ticket, so there's one source of truth for what's pending instead of two or three paper trails that can drift out of sync. This matters more as order volume goes up — a single cook rarely needs it, but a kitchen running three or four sections during a weekend rush usually does."
      },
      {
        "q": "Can one kitchen station use a KOT printer while another uses a display screen?",
        "a": "Yes — a kitchen doesn't have to be all-paper or all-screen. Since a thermal printer is optional hardware and the kitchen display just runs in a browser on whatever device you already have, a café can print at a station where staff prefer a physical slip — say, a cramped counter with no room for a tablet — while other sections work directly off the screen. This is common in kitchens mid-transition from paper to digital; you don't need to switch everything over on day one."
      },
      {
        "q": "Does a kitchen display show how long each order has been waiting?",
        "a": "A kitchen display's advantage over a paper KOT pile is exactly this — because every ticket carries its order time digitally instead of being buried under three more slips, staff can see at a glance which order came in first. That's what lets a kitchen actually work through orders in sequence during a rush rather than by whichever ticket happens to be on top. A printed ticket only tells you what to make; it doesn't tell you how long it's been sitting there once it's under a stack."
      },
      {
        "q": "What happens to orders on the kitchen display if the tablet or screen restarts mid-service?",
        "a": "Because KhaoPiyo's kitchen display pulls the current order queue from the cloud rather than storing it only on that device, a screen that restarts or refreshes reloads the open tickets that are still pending once it's back online — the order itself isn't lost. The gap is only while that specific device is down: nothing shows on that screen during the restart, so if it's your only kitchen display, it's worth keeping a KOT printer or a second device as a fallback for exactly this situation."
      },
      {
        "q": "How does the kitchen see it when an order is cancelled or changed after it's already sent to the display?",
        "a": "On KhaoPiyo, a cancellation goes through \"Cancel with Reason\" rather than someone quietly crossing an item off, so there's a recorded reason attached to it — useful later if you're checking why an item didn't go out. For the kitchen itself, the change reflects on the live ticket instead of requiring a fresh paper KOT to be walked over and swapped, which is one less trip between the counter and the pass during service. It's one of the more concrete everyday differences between a screen and a printed slip once a café is running actual service, not just billing."
      },
      {
        "q": "How long does it take kitchen staff to get used to a kitchen display instead of paper KOTs?",
        "a": "This varies with how comfortable your team already is with a phone or tablet, but the learning curve is usually shorter than owners expect, because the screen still shows the same information a KOT would — items, quantities, table or order number, any notes. Most of the adjustment is a habit change, looking up at a screen instead of grabbing a slip off a spike, rather than a skills problem, and it tends to settle within the first few days of regular service. Running the display alongside a printer for the first week, if you have one, gives staff a fallback while they adjust."
      },
      {
        "q": "Do I have to pay extra for a kitchen display system, or is it included with billing software?",
        "a": "On KhaoPiyo, the Kitchen Display System is included on every plan, including Starter at ₹999/month — it isn't an add-on or a feature locked behind a higher tier. What changes between plans is things like table reservations, loyalty and inventory; KOT and kitchen display are treated as basic operating software, not premium extras."
      },
      {
        "q": "How many kitchen display screens can one café run at the same time?",
        "a": "There's no hardware limit built into a kitchen display since it runs in a browser rather than needing a dedicated POS terminal — practically, a café can open it on as many devices as it already owns, a tablet at the grill, another near the pass, a phone taped up at the bar, and each one shows the live order queue. The real constraint tends to be less about the software and more about what actually fits your kitchen layout and how many screens staff will look at instead of ignoring."
      }
    ]
  },
  {
    "category": "Table management & Live Tables",
    "faqs": [
      {
        "q": "What's a live table view, and how is it different from just using a paper table chart?",
        "a": "A live table view is a real-time floor plan showing which tables are free, occupied, or waiting on the bill, updating the moment an order is placed or a table is closed out — unlike a paper chart, which only reflects what someone remembered to write down. In KhaoPiyo, Live Tables updates automatically as QR orders come in, a waiter adds items tableside, or POS billing closes a table, so whoever glances at their screen sees the floor as it actually is, not as it was ten minutes ago. That gap matters most during a rush, when a paper chart falls behind reality within the first few busy minutes."
      },
      {
        "q": "Can two waiters end up taking the same table's order at the same time?",
        "a": "Without real-time sync, yes — two waiters working off memory or a paper pad can both walk up to a busy table and log separate, conflicting orders. Live Tables in a cloud POS like KhaoPiyo prevents this because every device updates the instant an order changes, so if table 4 already has an order open, the next waiter checking their screen sees exactly what's on it instead of starting a duplicate. This is what Real-Time Sync does on every KhaoPiyo plan, Starter included."
      },
      {
        "q": "What happens to a held order if the customer walks out without paying?",
        "a": "A held order stays parked exactly as it was — items, quantities, table if any — until someone resumes it or actively closes it out; it doesn't auto-cancel on its own. If a customer walks off without paying, the right move is to cancel it and record a reason (walked out, wrong order, changed mind) so the till and kitchen totals for the day stay accurate instead of showing a sale that never happened. Held Orders and Cancel with Reason are both included on every KhaoPiyo plan, so this cleanup step is always available without needing a higher tier."
      },
      {
        "q": "How does a waiter take orders directly from the table without walking to the counter?",
        "a": "On KhaoPiyo, this is Waiter Tableside Quick-Add — a waiter opens the table on their own phone or tablet, taps in what the guest is ordering, and it lands straight in the kitchen queue without anyone walking back to a counter terminal. It's included on every plan, so even a single-till café with an owner and one or two waiters gets it without needing a higher tier. It matters most when there's no fixed order-taking counter, or when the counter is already busy handling QR and walk-in orders and can't also chase table orders."
      },
      {
        "q": "Is a live table view even necessary for a small café with just 4-5 tables?",
        "a": "With four or five tables and one person mostly running service, a notebook can genuinely hold up for a while — the failure point is usually staff count and rush hours, not table count. Once more than one person is taking orders, or QR ordering is running alongside walk-ins, a paper system starts losing track of who already ordered and who's waiting on the bill, which is exactly the gap a live table view closes. Live Tables is included on every KhaoPiyo plan regardless of café size, so it's less about whether your café is big enough and more about whether more than one person needs the same accurate picture of the floor at once."
      },
      {
        "q": "What's the difference between marking a table occupied and taking a table reservation?",
        "a": "Marking a table occupied is a same-moment update — it tells staff a table is in use right now, changing the instant an order is placed or guests are seated. A reservation is forward-looking: it blocks a table for a guest arriving later, so the floor view shows it as reserved rather than free even before anyone sits down. On KhaoPiyo, live table status — occupied, free, or waiting to bill — is available on every plan, while advance Table Reservations is a Growth-plan feature (₹2,499/month), built for cafés that take bookings for evenings or weekends."
      },
      {
        "q": "Can I merge two tables into one bill when a group pushes tables together?",
        "a": "This is a common floor scenario — a group asks to push two tables together, and the question is whether your system reflects that as one bill instead of two. In practice it's handled either by billing everything under a single table number from the start, which works on any POS including KhaoPiyo, or by a dedicated table-merge function if the software you're using has one. If this comes up often at your café — weekend family groups are the usual case — it's worth knowing exactly how your POS wants you to handle it before you're mid-service with a bill already half-built."
      },
      {
        "q": "How do I split a bill between guests sitting at the same table?",
        "a": "Splitting a bill usually means one of two things — dividing the total equally between guests, or splitting it by exactly what each person ordered (an itemized split) — and which one you need changes how you handle it. An equal split can be done with simple math at the counter regardless of what POS you're running, while an itemized split needs the system to let you separate specific items onto separate payments before the table closes. If bill-split requests are common at your café — groups of students or coworkers tend to ask for this — it's worth confirming which of the two your POS actually supports rather than assuming."
      },
      {
        "q": "Does a live table view actually help during a rush, or is it just a nice-looking screen?",
        "a": "The real value shows up during a rush, not on a quiet afternoon — when five tables are at different stages (just seated, order placed, waiting on the kitchen, ready to bill) and only two staff are managing the floor, a live table view is what stops someone asking a table twice what they ordered or missing that a bill is ready. On a slow day, one person can often just remember four tables without checking a screen at all. It earns its place at the point memory alone stops being reliable — festival weekends, weekend dinner rushes, or whenever more than one staff member is working the same floor."
      },
      {
        "q": "Does a live table view make sense for a QSR or counter-only setup with no seating?",
        "a": "Not really in the same way — a live table view is built around tracking table status (free, occupied, waiting to bill) for a sit-down floor, so it has little to track when there's no seating. What matters more for a counter-only setup is Held Orders, to park one order while handling the next customer in line, and fast quick-add entry at the counter — both included on every KhaoPiyo plan regardless of whether the café has a single table. Cafés that run both a counter and a handful of tables, common in India, end up using Live Tables and Held Orders together rather than picking one over the other."
      }
    ]
  },
  {
    "category": "Customer CRM, loyalty, coupons, Spin & Win, wallet",
    "faqs": [
      {
        "q": "What is a customer CRM system for a restaurant or café?",
        "a": "CRM in a café context usually just means a directory of everyone who has ordered from you — name, phone number, order history, and how often they visit — so staff can recognise a regular instead of treating every walk-in as new. Without it, a café has no record of who its actual repeat customers are, and no way to reach them beyond hoping they come back on their own. On KhaoPiyo, this Customer Directory is built automatically from counter billing and QR orders, and it's included from the Starter plan (₹999/month) — you don't need a higher plan just to see who your customers are."
      },
      {
        "q": "How does a points-based loyalty program work for a restaurant?",
        "a": "A points-based loyalty program gives customers points for every rupee spent (or every visit), which they can later redeem for a discount, a free item, or a fixed amount off a future bill. The goal is to make a second or third visit feel like it's building toward something, rather than every visit being treated the same as the first. On KhaoPiyo, Loyalty & Rewards is part of the Growth plan (₹2,499/month), bundled with Coupons, Spin & Win, and Customer Wallet under the same customer record used for CRM."
      },
      {
        "q": "What is Spin & Win in a café app?",
        "a": "Spin & Win is a gamified reward — instead of a flat discount, the customer gets a spin, usually after billing or during QR ordering, that lands on a randomised reward like a discount, a coupon, or bonus wallet credit. A chance-based reward tends to feel more engaging than a fixed one of similar value, and it gives customers a small reason to come back and try again. On KhaoPiyo, Spin & Win sits in the Growth plan next to Loyalty & Rewards and Coupons, so a spin's prize can be paid out as wallet credit, loyalty points, or a coupon from the same system."
      },
      {
        "q": "How do coupon codes work with billing in a café POS?",
        "a": "A coupon is a code or button tied to a rule — a flat amount off, a percentage off, or a discount on a specific item — that a cashier applies at billing, or a customer applies themselves through QR ordering. Unlike a manual discount a cashier types in on the spot, a coupon can be restricted (dates, minimum order value, one per customer) and shows up separately in reports, so you can see exactly what the offer cost and whether it worked. On KhaoPiyo, Coupons is part of the Growth plan and works alongside Discounts, which is on every plan — Discounts is for a cashier's on-the-spot judgment call, Coupons is for a planned offer you can track."
      },
      {
        "q": "What is a customer wallet in a restaurant billing system?",
        "a": "A customer wallet is a prepaid balance tied to a customer's account — money they load in, or credit they receive from a refund, a loyalty conversion, or a Spin & Win reward — that gets spent against future bills instead of cash or card. It behaves like a gift card that lives inside the POS rather than a physical card, and because it sits on the same customer record as CRM and loyalty, staff can see and apply it at the counter without the customer carrying anything extra. On KhaoPiyo, Customer Wallet is part of the Growth plan, with Online Payments via Razorpay (also in Growth) available for customers who'd rather add money digitally than in cash."
      },
      {
        "q": "Loyalty points or coupons — which is better for a small café?",
        "a": "They solve different problems rather than competing directly: coupons work well for a specific, time-bound push — a new item, a slow weekday, a festival — while loyalty points reward the relationship over time and only start to feel worthwhile once a customer has returned a few times. A small café with irregular footfall often sees a faster, more visible result from coupons, while loyalty is a slower game that needs consistent repeat volume to pay off. KhaoPiyo's Growth plan includes Coupons and Loyalty & Rewards together under one customer record, so a café isn't forced to pick one before trying the other."
      },
      {
        "q": "How does a café recognise repeat customers automatically?",
        "a": "It comes down to having a customer record — usually built on the phone number captured at billing or QR ordering — that lets the POS recognise someone as a returning customer rather than a fresh walk-in each time. Once that record exists, staff can see order history and apply loyalty points or wallet balance without relying on memory or asking whether the customer has visited before. This is the Customer Directory / CRM feature, included from KhaoPiyo's Starter plan — the loyalty, coupon, and wallet tools in Growth all build on top of that same record."
      },
      {
        "q": "Does a loyalty program actually get customers to come back?",
        "a": "A rewards program on its own doesn't create loyalty — it works best when it rewards something a customer already wanted to do, like a regular's usual order or a nearby office lunch crowd, rather than trying to manufacture repeat visits out of a one-time customer. Where it genuinely helps is making an existing regular's habit feel slightly more valuable, and giving a café a concrete record to identify who hasn't shown up in a while. It's a retention layer on top of good food, service, and pricing — not a replacement for any of them."
      },
      {
        "q": "What happens to loyalty points or wallet balance if a customer stops visiting?",
        "a": "This is a policy decision for the café, not something fixed by the software — a wallet balance is money the customer has already paid in, so it typically stays available until they spend it or ask for it back, while loyalty points are usually the café's own call on whether and when they expire. Because both sit on the same customer record as CRM, a café can also use a long gap between visits as a signal, pulling up inactive customers from the directory rather than only noticing once they've stopped coming for good. There's no universal expiry rule here — it depends entirely on how the café sets it up."
      },
      {
        "q": "Can a café run coupons and Spin & Win at the same time?",
        "a": "There's no real conflict between them — a coupon is something a customer applies deliberately, through a code or a QR-ordering promo, while Spin & Win is a randomised reward triggered at a separate moment, typically right after billing. Running both just gives you two different ways of putting an offer in front of a customer: one they seek out, one that shows up as a surprise. On KhaoPiyo, both live in the Growth plan under the same customer record, so a Spin & Win prize can itself be a coupon or wallet credit rather than a separate system to manage."
      }
    ]
  },
  {
    "category": "Payments & receipts",
    "faqs": [
      {
        "q": "What's the difference between UPI at the counter and Razorpay online payments?",
        "a": "Customer UPI, included on every KhaoPiyo plan, is a UPI QR the customer scans at the counter or table after the bill is made, with the money going straight into the café's own bank account. Online Payments through Razorpay, available from the Growth plan up, is a full payment gateway that lets a customer pay by UPI, card or wallet at the moment they place a QR order, before it even reaches the kitchen. Most dine-in, walk-in cafés manage fine on counter UPI alone; Razorpay matters more once you're taking prepaid or online-first orders."
      },
      {
        "q": "Can customers pay online while ordering from the QR code menu, or only at the counter?",
        "a": "Both are possible on KhaoPiyo, depending on your plan. Pay at Counter is included on every plan — the order goes straight to the kitchen while the customer settles the bill with cash or UPI once they're done. On Growth and Scale, Online Payments through Razorpay lets a customer pay right when they place the QR order, which suits takeaway or busy counters where you'd rather collect payment upfront."
      },
      {
        "q": "Can I accept part cash and part UPI for the same bill at my café?",
        "a": "Yes — this comes up often, especially when a customer's UPI payment fails partway and they want to top up with cash instead. KhaoPiyo's POS billing accepts both cash and Customer UPI at checkout on every plan, and Cash Shift & Drawer Reconciliation at the end of the day tallies exactly how much came in as cash versus digital, so a mixed payment doesn't throw off your till count."
      },
      {
        "q": "What happens if an online payment fails or the customer's bank is slow to respond?",
        "a": "Online payments can fail or hang for reasons that have nothing to do with your café — a weak signal, a slow bank server, a declined card. The safe habit is to never let the kitchen or the bill wait on a stuck online payment. On KhaoPiyo, Pay at Counter is available on every plan regardless of whether Razorpay online payments are switched on, so staff can always fall back to cash or UPI at the counter and keep service moving."
      },
      {
        "q": "Should a small café bother with online payments, or is UPI at the counter enough?",
        "a": "For a mostly dine-in, walk-in café, Customer UPI at the counter — included on every KhaoPiyo plan — already covers most digital payment demand at no extra cost. Online Payments through Razorpay, on Growth and Scale, earns its keep once a meaningful share of orders come through the QR menu ahead of time, for takeaway pickup, or where you want payment collected before the kitchen starts cooking. Since sign-up is free and a café can start billing on Starter first, it's reasonable to watch how customers actually pay for a few weeks before deciding whether to upgrade."
      },
      {
        "q": "How do I send a customer their bill on WhatsApp instead of printing it?",
        "a": "Every KhaoPiyo plan already generates a Digital Receipt for each sale. On the Growth plan, SMS + WhatsApp bill receipts let you deliver that same receipt straight to the customer's phone the moment the bill is closed, instead of — or alongside — a printed copy, so paper isn't the only way a customer walks away with proof of payment."
      },
      {
        "q": "SMS or WhatsApp — which is better for sending bill receipts to customers?",
        "a": "SMS reaches a phone even without a data connection or WhatsApp installed, which matters for older customers or patchy-network areas. WhatsApp lets you send a proper itemised bill instead of a plain text line, and most regulars already have it open anyway. KhaoPiyo's Growth plan includes both under SMS + WhatsApp bill receipts, so you're not forced to pick one — send whichever fits the customer, and switch anytime without a plan change."
      },
      {
        "q": "Is a digital receipt the same thing as a GST invoice?",
        "a": "Not automatically — a plain receipt just confirms a payment was made, while a valid GST invoice needs specific details like your GSTIN, HSN/SAC codes and a clear tax breakup, useful for a customer's own accounting or expense claims. On KhaoPiyo, GST Invoicing is included on every plan, so the Digital Receipt generated for each sale already carries those fields rather than being a bare payment slip."
      },
      {
        "q": "If I use Razorpay for online payments, do I get charged twice — once by KhaoPiyo and once by Razorpay?",
        "a": "Not for the same thing — they charge for different things. KhaoPiyo never takes a cut of your sales; you pay only the flat monthly or yearly subscription for your plan, regardless of how much you bill that month. Razorpay, used for Online Payments on the Growth and Scale plans, is a separate payment gateway and applies its own standard transaction charges on the payments it processes — the same as it would for any business using Razorpay directly, and separate from your KhaoPiyo subscription."
      },
      {
        "q": "What happens to a payment if the internet drops right as a customer is paying online?",
        "a": "KhaoPiyo is cloud software, so both billing and online payments need a working internet connection to go through — if the connection drops mid-transaction on a Razorpay payment, it simply doesn't complete and needs to be retried once signal is back. The safer habit during patchy internet is to fall back to Customer UPI or cash at the counter, both available on every plan independent of the online gateway, so the customer isn't left standing there waiting."
      }
    ]
  },
  {
    "category": "Staff management & reports",
    "faqs": [
      {
        "q": "Can I limit what a waiter or cashier can see and do in my café's POS system?",
        "a": "Yes — every staff member in KhaoPiyo gets their own login, and what they can see is restricted by role, a feature called per-role screen access that's included on every plan, not just the higher tiers. A waiter using tableside quick-add to fire orders to the kitchen doesn't need to see your daily sales totals or open café settings, while an owner or manager account can. You decide which screens each role opens, so a new hire isn't handed access to numbers they don't need on day one."
      },
      {
        "q": "How do I make sure staff can't cancel a bill without giving a reason?",
        "a": "Cancel with Reason is built into KhaoPiyo's billing flow on every plan, so an order can't just be voided and disappear — the staff member has to record why (wrong item punched in, customer walked out, kitchen ran out of stock). That reason sits against the order in your records along with the staff login that cancelled it, which is far more useful at month-end than a blank gap in your sales."
      },
      {
        "q": "Why doesn't my cash drawer match the day's sales at closing time?",
        "a": "A mismatch usually comes down to a handful of things: wrong change given, a cash sale marked as UPI or the reverse, an expense paid out of the drawer without a note, or a plain miscount. KhaoPiyo's Cash Shift & Drawer Reconciliation, included on every plan, has staff record an opening float and closing count against the system's expected total, so a gap shows up right at shift end instead of getting discovered — or missed — days later."
      },
      {
        "q": "What reports should I actually check every day as a café owner?",
        "a": "At minimum: total sales and how they split by payment mode, which items sold and which didn't, cancelled orders and the reasons behind them, and whether the cash drawer reconciled at shift close. KhaoPiyo's Core Reports, included on every plan, cover this daily view, and the built-in Recommendations feature — also on every plan — helps surface patterns in that data instead of you comparing raw numbers by hand."
      },
      {
        "q": "Should every staff member have their own login, or can they share one at the counter?",
        "a": "Separate logins are worth having even for a two-person counter — it's the only way a discount, a cancelled order, or a drawer shortfall can be traced back to who actually did it, instead of 'someone on the evening shift.' KhaoPiyo's Staff Accounts & Roles are built around this: Starter supports up to 3 staff, Growth up to 8, and Scale unlimited, so even a small café isn't forced to share one login just to fit a plan."
      },
      {
        "q": "What is role-based access control in a restaurant POS system?",
        "a": "It's the practice of giving each staff member a login tied to a specific role — owner, cashier, waiter, and so on — and limiting what that role can see and do accordingly. A waiter typically needs to take and send orders, not view revenue reports or change menu prices; a cashier needs to bill and close shifts, not necessarily edit other staff accounts. Most modern restaurant POS software supports some version of this, and it starts to matter once your team grows past one or two people who used to just share whatever access there was."
      },
      {
        "q": "Can staff refund an old bill from a few days ago on their own?",
        "a": "Not by default — in KhaoPiyo, refunds made the same day are supported on every plan, but issuing a refund against a bill from an earlier day needs the Scale plan, which specifically includes refunds beyond a day. So if a customer comes back a week later disputing a bill, that's a Scale-plan action rather than something every staff login on a Starter or Growth café can do on its own."
      },
      {
        "q": "What is a GST register and does my café need one?",
        "a": "A GST register is a structured record of the GST you've collected on sales — and for some businesses, paid on purchases — over a period, laid out to make filing GST returns easier than pulling numbers off individual invoices one by one. Every KhaoPiyo plan generates a GST invoice for each bill, but the standalone GST Register report is one of the additions on the Scale plan, alongside Advanced Reports and Inventory. A single small café can usually manage return filing off individual invoices for a while; it's cafés running multiple outlets or higher volumes where a proper register starts saving real time."
      },
      {
        "q": "How do I find out if a staff member is giving too many discounts?",
        "a": "Since every discount in KhaoPiyo is applied under whichever staff login is on the bill, and that activity feeds into Core Reports (included on every plan), the first real step is comparing discount totals across shifts and staff rather than waiting for it to show up as a revenue problem later. One person's shifts consistently running higher discount value for similar footfall is usually the tell. Because Cancel with Reason and cash shift reconciliation are tracked the same way, discounting, cancelling and drawer shortfalls tend to show up together when something's genuinely off, rather than as one-off mistakes."
      },
      {
        "q": "What's the difference between Core Reports, Advanced Analytics and Advanced Reports in KhaoPiyo?",
        "a": "Core Reports are included on every plan — Starter, Growth and Scale — and cover day-to-day numbers: sales, cancellations, and drawer reconciliation, enough to run a single café. Advanced Analytics is added from the Growth plan onward, alongside features like Loyalty and Table Reservations, once you're managing up to 2 cafés. Advanced Reports is a Scale-only addition on top of that, alongside Inventory, Recipes & Purchases and GST Register, aimed at operations running multiple outlets where you need to dig deeper and compare across locations."
      }
    ]
  },
  {
    "category": "Inventory, recipes, purchases & multi-café operations",
    "faqs": [
      {
        "q": "What is recipe-linked inventory in a restaurant POS system?",
        "a": "Recipe-linked inventory means every dish on your menu has a recipe behind it — say, a cappuccino uses 200ml milk, 18g coffee, one cup — and the system deducts those raw quantities from stock automatically every time that dish is billed, instead of someone counting stock by hand at day's end. This is what turns a POS from just a billing tool into something that can tell you how much milk you actually have left without a physical check. In KhaoPiyo, this sits under the Scale plan's \"Inventory, Recipes & Purchases\" bundle, on top of everything included in Starter and Growth."
      },
      {
        "q": "How do purchase orders work in a café inventory system?",
        "a": "A purchase order is simply a record of what you're buying from a supplier — item, quantity, rate — created when stock is ordered or received, so what comes into your kitchen has a paper trail instead of relying on memory or a WhatsApp message to the vendor. When purchases are tracked in the same system that holds your recipes and stock levels, receiving an order updates your on-hand inventory directly, so the numbers used for costing stay current instead of drifting from reality. This is part of the Inventory, Recipes & Purchases feature set on KhaoPiyo's Scale plan."
      },
      {
        "q": "How do I find out how much a dish actually costs to make?",
        "a": "Food costing means pricing out a dish's recipe against current ingredient rates — multiply each ingredient's quantity in the recipe by its cost per unit, add them up, and that's your per-plate cost, which you then compare against your menu price to see the real margin. Done on paper, this needs updating by hand every time an ingredient rate changes, which most kitchens simply don't keep up with. When recipes are linked to purchases and inventory in one system, as on KhaoPiyo's Scale plan, the per-dish cost can reflect current ingredient rates instead of a spreadsheet from three months ago."
      },
      {
        "q": "What happens when an ingredient runs low during service?",
        "a": "If stock isn't tracked against recipes, you usually only find out an ingredient is over when a cook can't make the next order — the worst possible moment to discover it. With recipe-linked inventory, every sale deducts the ingredients that dish actually uses, so stock levels reflect real usage instead of the last physical count, and a manager can check what's running low before it holds up service. This tracking is part of the Inventory, Recipes & Purchases feature set on KhaoPiyo's Scale plan."
      },
      {
        "q": "Does a small single-outlet café really need inventory tracking, or is that only for bigger chains?",
        "a": "For a small café with a short menu and one or two people handling stock, a weekly physical count and gut feel can work fine for a while. It starts breaking down once your menu grows, you add staff who don't have the same feel for stock levels, or ingredient costs start eating into margins without anyone noticing exactly why. That's largely why KhaoPiyo keeps Inventory, Recipes & Purchases on the Scale plan rather than every plan — it's built for the point where a café needs that discipline, not for every café from day one."
      },
      {
        "q": "Can I run multiple café branches from a single POS account?",
        "a": "Yes — this is standard in cloud POS systems built for more than one outlet, where each branch bills independently but ownership and reporting sit in one account instead of separate logins per location. On KhaoPiyo, the Growth plan supports up to 2 cafés and the Scale plan up to 6, both from a single account, with the Owner Command Center giving a combined view across locations rather than checking each café separately."
      },
      {
        "q": "Do I need separate staff logins and settings for each café branch, or can I manage everything centrally?",
        "a": "Both — good multi-outlet software gives each branch its own staff and settings so day-to-day operations don't get mixed up, while still letting the owner manage and view everything from one place rather than logging into each café separately. In KhaoPiyo, Staff Accounts & Roles and Per-Role Screen Access control who can see and do what, Café Profile & Settings keeps each location's details separate, and the Owner Command Center is the single view across them all — available up to 2 cafés on Growth and up to 6 on Scale."
      },
      {
        "q": "What is cash shift reconciliation and why does it matter at closing time?",
        "a": "Cash shift reconciliation is the process of matching the cash actually counted in the drawer against what the system expected based on cash sales for that shift — opening float plus cash billed should equal what's physically there at close. It matters because it's the simplest check against billing mistakes, unrecorded discounts, or cash going missing without anyone noticing until much later, and a discrepancy from a few hours ago is far easier to trace than one from last week. Cash Shift & Drawer Reconciliation is included on every KhaoPiyo plan, not gated to a higher tier."
      },
      {
        "q": "What happens if the cash drawer doesn't match the day's sales at closing?",
        "a": "A mismatch shouldn't be hidden or rounded off — it should show up clearly against that specific shift so a manager can see the gap and look into it, whether it's a genuine counting slip, a discount that wasn't billed correctly, or something to raise with staff. KhaoPiyo's Cash Shift & Drawer Reconciliation, included on every plan, records the system-expected cash total against what's actually counted, so any difference is visible right at closing instead of getting buried in a week's worth of takings. Catching it the same day is what makes the difference — a small gap is easy to explain on the spot, much harder to reconstruct two weeks later."
      },
      {
        "q": "How does linking recipes to inventory help catch stock discrepancies?",
        "a": "Once every dish has a recipe, the system knows exactly how much of each ingredient should have been used based on what was actually sold — so if recipe-based usage says you should have 2kg of paneer left but a physical count shows 1.2kg, that gap points to something worth investigating, whether it's over-portioning, wastage, or stock going missing. Without that link, a kitchen only has total purchases and a vague sense of what's left, with no real baseline to compare against. This kind of recipe-to-stock comparison is part of Inventory, Recipes & Purchases on KhaoPiyo's Scale plan."
      }
    ]
  },
  {
    "category": "Choosing, switching & operating software",
    "faqs": [
      {
        "q": "How do I switch from writing bills by hand to a POS system without confusing staff on day one?",
        "a": "Run the two side by side for one full shift instead of switching cold — keep the old bill book at the counter as a backup while staff enter the same orders on the new system, so nobody panics if they hit an unfamiliar button during peak hours. Train on just the core flow first — take order, print KOT, settle bill — and leave extras like coupons or reports for the second or third day once billing itself feels automatic. On KhaoPiyo, sign-up is free and setup takes about as long as building your menu list, so you can get the system ready and test it with a few dummy orders before a real customer ever sees it."
      },
      {
        "q": "How do I move my menu, prices and customer list to a new POS system?",
        "a": "Most of the time this isn't a technical data migration — it's re-typing your menu and prices into the new system, which for a typical café menu is an hour or two of work, not a project. Customer and past sales history usually doesn't carry over automatically between two different vendors' systems since each stores it differently, so it's worth asking your current provider whether they'll export your customer list and sales history before you cancel. On KhaoPiyo, you build your menu, categories and prices directly in the café dashboard, and Customer Directory / CRM starts capturing new customers from your very first bill onward."
      },
      {
        "q": "What's the real difference between cloud POS software and desktop billing software installed on one computer?",
        "a": "Desktop billing software runs on a single machine and stores its data locally, so you're responsible for backing it up yourself — if that computer's hard disk fails, your sales history can go with it. Cloud POS runs in a browser, saves data online as you go, and lets an owner check sales or reports from a phone away from the counter, but it needs an internet connection to actually take a payment or print a bill. The trade-off is flexibility versus dependency: cloud is easier to access and harder to lose data from, but it stops working the moment your internet does."
      },
      {
        "q": "Is a full POS system overkill for a small tea stall or a 2-3 table QSR counter?",
        "a": "It depends on what you actually need — if you're taking cash at a single counter with no GST requirement, a POS system is more machinery than the business needs. But the moment you need a proper GST invoice, want an order to reach the kitchen without shouting it across the counter, or want to know which items actually sold this week, a lightweight plan covers that without forcing in features you'll never touch. KhaoPiyo's Starter plan is built for exactly this size — one café, up to 3 staff, QR ordering, billing, KOT, GST invoicing and a customer directory — without inventory or multi-café tools a single small counter doesn't need."
      },
      {
        "q": "What's the difference between paying monthly and paying yearly for café software?",
        "a": "Monthly billing gives you flexibility if you're still deciding whether a system fits your café — you pay a bit more overall per month, but you can stop anytime without having prepaid a year you didn't use. Yearly billing is a lump sum upfront in exchange for a lower effective monthly rate, and on some plans the following year renews even cheaper than the first. On KhaoPiyo's Starter plan, for example, monthly works out to ₹999/month, the first year is ₹10,000 paid upfront, and it renews at ₹5,000/year after that — so yearly pays off once you're sure the café is sticking with it."
      },
      {
        "q": "Is my café's sales and customer data actually safer on a cloud POS than in a paper register?",
        "a": "A physical bill book has a single point of failure — it can be misplaced, damaged, or lost with an entire day's sales in it, and there's no backup unless you photocopy every page. Cloud software stores your data on servers rather than on one object sitting at your counter, so a spilled chai or a missing notebook doesn't wipe out your records. That said, \"cloud\" isn't automatically secure by itself — restrict which staff can see what using role-based access rather than one shared login; KhaoPiyo's Staff Accounts & Roles and Per-Role Screen Access exist so a waiter's login can't touch the settings or reports meant for the owner."
      },
      {
        "q": "What is vendor lock-in, and how do I avoid it when choosing restaurant software?",
        "a": "Vendor lock-in is when switching away from a software provider later becomes expensive or painful — because of a long contract, a cancellation penalty, or because your own sales and customer data is stuck in a format only that system can read. Before signing up for any POS, it's worth asking two questions: is there a minimum contract period, and can you actually get your own data out if you leave? KhaoPiyo has no lock-in contract and can be cancelled anytime, but this is a question worth putting to any restaurant software before you build a year of sales history inside it."
      },
      {
        "q": "What happens to my café's POS setup if the staff member who configured it leaves?",
        "a": "This is a common worry for small teams — one person sets up the menu, roles and settings, and then moves on, leaving the owner unsure how to make changes. As long as the owner has their own login with full access rather than relying on the departing staff member's login, nothing about the system's setup depends on any one person staying employed. KhaoPiyo's Owner Command Center gives the café owner access to settings, staff accounts and reports independent of any individual login, and Staff Accounts & Roles let you remove or add a login the moment someone leaves."
      },
      {
        "q": "Can I run a café POS on an Android tablet, or do I actually need a computer at the counter?",
        "a": "Yes — cloud POS software runs inside a browser, so an Android tablet or even a phone works the same way a desktop computer would, with no special app to install. This matters for a small counter where buying a dedicated computer isn't worth it: KhaoPiyo runs on whatever device you already have, whether that's an Android tablet mounted at the counter or a phone the owner checks reports from at home, and a thermal printer is optional for physical KOTs or receipts, not required to bill."
      },
      {
        "q": "Can more than one staff member use the POS at the same time on different devices?",
        "a": "Yes — this is normal for a busy café, where a waiter takes an order tableside on one phone while billing happens on a tablet at the counter, and both need to show the same live picture of tables and orders. KhaoPiyo supports this through Staff Accounts & Roles, so each staff member logs in separately, combined with Real-Time Sync, so an order added via Waiter Tableside Quick-Add appears at the counter and kitchen display immediately instead of needing to be re-entered. How many staff can be active at once comes down to your plan's staff limit — Starter allows up to 3, Growth up to 8, and Scale is unlimited — not the number of devices in use."
      }
    ]
  }
]

export const ALL_FAQS: Faq[] = FAQ_CATEGORIES.flatMap((c) => c.faqs)
