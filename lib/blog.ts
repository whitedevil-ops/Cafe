import type { Faq } from '@/lib/seo'

// Blog content lives in TypeScript rather than MDX on purpose: no extra
// dependency, no runtime markdown parser, and every article is type-checked
// alongside the rest of the app. Inline markup is deliberately limited to the
// two things prose actually needs — **bold** and [links](/path) — which are
// rendered by lib/rich-text.tsx.

export type Block =
  | { t: 'p'; text: string }
  | { t: 'h2'; text: string }
  | { t: 'h3'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'note'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] }

export type Article = {
  slug: string
  /** <title>. Kept under ~60 chars so it isn't truncated in results. */
  title: string
  h1: string
  description: string
  keywords: string[]
  /** ISO date. Real dates only — a backdated post is a lie with a timestamp. */
  published: string
  updated?: string
  readingMinutes: number
  excerpt: string
  body: Block[]
  faqs?: Faq[]
  /** Slugs of other articles, plus product pages worth reading next. */
  related: { label: string; href: string }[]
}

export const ARTICLES: Article[] = [
  {
    slug: 'how-to-choose-restaurant-pos-software',
    title: 'How to Choose Restaurant POS Software in India',
    h1: 'How to choose restaurant POS software in India',
    description:
      'A practical guide to picking a restaurant POS in India: the questions that actually matter, the costs vendors leave out, and the checks to run before you sign anything.',
    keywords: [
      'how to choose restaurant POS software', 'best POS software for restaurants India',
      'restaurant POS buying guide', 'POS system selection restaurant',
    ],
    published: '2026-08-11',
    readingMinutes: 9,
    excerpt:
      'Most POS comparisons are feature checklists. Feature checklists are how you end up paying for eleven modules and using three. Here is what to ask instead.',
    body: [
      {
        t: 'p',
        text: 'Almost every restaurant POS in India can take an order, print a bill and produce a GST invoice. If those three things were the decision, you could pick at random. What separates one system from another is everything around them: what it costs after the first year, what happens when the internet drops on a Saturday, whether your data leaves with you if you switch, and how many taps it takes to do the thing your staff do four hundred times a day.',
      },
      {
        t: 'p',
        text: 'This is a guide to the questions worth asking. It is written by a team that builds one of these systems, so read it with that in mind — but the questions apply whichever vendor you end up with, including us.',
      },
      { t: 'h2', text: '1. Start with your actual service pattern, not the feature list' },
      {
        t: 'p',
        text: 'A twelve-seat café where the owner bills every order is a completely different problem from a sixty-cover restaurant with four servers and a bar. Before looking at any software, write down:',
      },
      {
        t: 'ul',
        items: [
          'How orders arrive — counter, table service, takeaway, delivery aggregators, or some mix.',
          'How many people touch the till in a shift, and whether you trust all of them with discounts.',
          'Whether a bill stays open while a table keeps ordering, or closes with each round.',
          'How many items are on the menu, and how often prices change.',
          'What your kitchen currently does when a new order lands.',
        ],
      },
      {
        t: 'p',
        text: 'That list eliminates more software than any comparison table. A system built around fixed-price counter service will fight you every night if you run open tables, no matter how many features it advertises.',
      },
      { t: 'h2', text: '2. Count the taps for your most common action' },
      {
        t: 'p',
        text: 'In a demo, ask to bill the single most common order in your café — say, two coffees and a sandwich, paid by UPI — and count the taps and screens. Then ask to do it again with an item that has a size and an add-on. Then ask to split it between two payment methods.',
      },
      {
        t: 'p',
        text: 'A difference of four taps sounds trivial. At two hundred bills a day it is eight hundred taps, every day, performed by someone under pressure with a queue forming. This is the single most under-weighted factor in POS buying and the one your staff will judge you on within a week.',
      },
      { t: 'h2', text: '3. Ask what the price is in year two' },
      {
        t: 'p',
        text: 'Indian restaurant POS pricing is frequently quoted as a discounted first-year figure, or per outlet after a sales call, with modules priced separately. Get these in writing before you commit:',
      },
      {
        t: 'ul',
        items: [
          'The renewal price, not the introductory one.',
          'Whether the price is per outlet, per till, or per user — and what happens when you add a second billing screen.',
          'Which modules are extra: inventory, loyalty, reports, QR ordering, an app for the customer.',
          'Setup, onboarding, training and data-migration charges.',
          'Whether any part of the pricing is a percentage of your sales.',
          'What support costs, and whether it is included at your plan level.',
        ],
      },
      {
        t: 'p',
        text: 'A vendor who will not publish a price is telling you something about how the price is set. KhaoPiyo publishes its three plans on the [pricing page](/pricing) for that reason, and takes no commission on your sales — but the point stands regardless of who you buy from: get the year-two number.',
      },
      { t: 'h2', text: '4. Decide how much offline capability you genuinely need' },
      {
        t: 'p',
        text: 'This is where most buying advice is either dishonest or lazy. Cloud POS systems need a working internet connection to bill. Legacy on-premise systems keep billing when the line drops but tie your data to one machine, need manual backups, and cost far more to maintain.',
      },
      {
        t: 'p',
        text: 'The honest question is not "does it work offline" but "what does an outage actually cost me here". If your area loses connectivity for hours at a time and you do two hundred covers, that is a real operational risk and you should weight it heavily. If your connection drops for a minute twice a week — which is most urban cafés with a decent broadband line and a mobile hotspot as backup — the trade-off runs the other way, because cloud software gives you a till that can be replaced in ten minutes when the computer dies.',
      },
      {
        t: 'note',
        text: 'Whatever you choose, ask specifically: if the internet drops mid-service, what does the staff see, and what does the kitchen screen do? A system that silently blanks is worse than one that says clearly that it is offline.',
      },
      { t: 'h2', text: '5. Check that you can get your data out' },
      {
        t: 'p',
        text: 'Ask for an export of your own sales, menu and customer data in a normal format — CSV or Excel — and ask whether you can do it yourself from the dashboard or whether you have to request it. If getting your history out requires an email to support and a wait, you are not really the owner of it.',
      },
      {
        t: 'p',
        text: 'Do the same in reverse before you buy: ask how your existing menu gets in. A 150-item menu with sizes and add-ons typed by hand is two days of work and a source of pricing errors for months. Bulk import from a spreadsheet should be standard.',
      },
      { t: 'h2', text: '6. Look at the reports you will actually open' },
      {
        t: 'p',
        text: 'Every POS advertises reporting. Most of it is a sales total by day, which your bank statement already tells you. The reports that change decisions are narrower:',
      },
      {
        t: 'ul',
        items: [
          'Item-level sales, so you can cut the twelve dishes nobody orders.',
          'Margin per item measured against real recipe cost, not a guessed food-cost percentage.',
          'Discounts, refunds and cancellations by staff member — the numbers that quietly leak money.',
          'A GST report your accountant can reconcile at filing time without re-keying anything.',
          'Turnaround time and peak load by hour, so you staff the right shift.',
        ],
      },
      {
        t: 'p',
        text: 'Ask to see each of these populated with demo data during the walkthrough, not described.',
      },
      { t: 'h2', text: '7. Test the failure cases, not the happy path' },
      {
        t: 'p',
        text: 'Demos show the happy path. Insist on the awkward ones, because these are what happen in real service:',
      },
      {
        t: 'ol',
        items: [
          'A guest wants to pay half in cash and half by UPI.',
          'A table orders three more items twenty minutes after the first round.',
          'An item was billed wrong and needs to come off after the kitchen already started it.',
          'A guest asks for the bill to be split by person, not by item.',
          'Someone needs a refund on one line of a completed bill, not the whole bill.',
          'The kitchen printer is out of paper mid-service.',
        ],
      },
      {
        t: 'p',
        text: 'How a system handles these tells you more than any feature list. So does the answer "we are adding that" — which is a legitimate answer, but only if you are told it plainly rather than shown a workaround dressed up as a feature.',
      },
      { t: 'h2', text: '8. Ask who answers when it breaks' },
      {
        t: 'p',
        text: 'Not the support hours on the website. Ask what happens at 9pm on a Saturday when billing stops. Is there a number that a human answers? Is that human able to fix anything, or only file a ticket? Ask an existing customer if you can find one.',
      },
      { t: 'h2', text: 'A short version' },
      {
        t: 'p',
        text: 'If you only have twenty minutes with a vendor: bill your most common order and count the taps, ask for the year-two price in writing, ask them to export your data in front of you, and ask what the kitchen screen shows when the internet drops. The answers to those four will separate the serious options from the rest faster than any comparison chart.',
      },
    ],
    faqs: [
      {
        q: 'What is the most important feature in a restaurant POS?',
        a: 'Speed at the counter, measured in taps for your single most common order. Everything else — inventory, loyalty, reports — is used occasionally by the owner; billing is used hundreds of times a day by staff under pressure. A system that is two taps slower per bill costs more over a year than most feature gaps.',
      },
      {
        q: 'Should a small café buy cloud POS or an offline system?',
        a: 'It depends on how reliable your connection is. Cloud POS is cheaper to run, needs no backups, and lets you replace a broken till by signing in on another computer — but it needs internet to bill. On-premise software keeps billing through an outage but ties your data to one machine and costs more to maintain. Judge it on how long and how often your connection actually drops.',
      },
      {
        q: 'How long does it take to switch restaurant POS software?',
        a: 'The software setup is usually a day or less if your menu can be imported from a spreadsheet. Staff getting genuinely fast on a new till takes about a week of service. The safest time to switch is at the start of a quieter week, not before a weekend.',
      },
    ],
    related: [
      { label: 'What restaurant POS software costs in India', href: '/blog/restaurant-pos-software-cost-india' },
      { label: 'KhaoPiyo pricing, published upfront', href: '/pricing' },
      { label: 'The full platform', href: '/restaurant-pos-software' },
    ],
  },

  {
    slug: 'restaurant-pos-software-cost-india',
    title: 'What Restaurant POS Software Costs in India',
    h1: 'What restaurant POS software actually costs in India',
    description:
      'A plain breakdown of restaurant POS pricing in India — subscription, per-outlet charges, setup fees, hardware and the costs vendors leave off the quote.',
    keywords: [
      'restaurant POS software cost India', 'POS software price restaurant',
      'restaurant billing software price', 'cafe POS software cost',
    ],
    published: '2026-08-11',
    readingMinutes: 7,
    excerpt:
      'The subscription is rarely the whole number. Here is every line that ends up on a restaurant POS bill, and which ones are negotiable.',
    body: [
      {
        t: 'p',
        text: 'Ask what restaurant POS software costs in India and you will get a range so wide it is useless — anything from free to six figures a year. The range is real, but it is mostly explained by four things: whether pricing is per outlet or per till, which modules are bundled versus sold separately, whether there is a setup fee, and whether the vendor takes a cut of your sales.',
      },
      {
        t: 'p',
        text: 'This breaks down the actual line items so you can compare two quotes that look nothing alike.',
      },
      { t: 'h2', text: 'The subscription' },
      {
        t: 'p',
        text: 'The headline number, usually monthly or annual. Three things change it more than the feature set does:',
      },
      {
        t: 'ul',
        items: [
          '**Per outlet vs per till.** A single restaurant with two billing screens can pay twice under one model and once under another. Ask explicitly.',
          '**Annual vs monthly.** Annual is normally cheaper per month but locks you in before you know whether the software suits you. For a first POS, monthly for the first few months is worth the premium.',
          '**Introductory vs renewal pricing.** A heavily discounted first year that renews at a much higher rate is common. Get the renewal figure in writing.',
        ],
      },
      {
        t: 'p',
        text: 'For context, KhaoPiyo publishes three plans at ₹999, ₹2,499 and ₹4,999 per month on its [pricing page](/pricing), with no setup fee and no commission. Other vendors price differently and many do not publish at all — the point of naming ours is to give you one concrete anchor, not to claim it is the cheapest.',
      },
      { t: 'h2', text: 'Setup, onboarding and training' },
      {
        t: 'p',
        text: 'A one-time fee, sometimes several thousand rupees, sometimes waived if you sign annually. What it covers varies a lot: menu entry, staff training, an on-site visit, or nothing much at all. Two questions decide whether it is worth paying:',
      },
      {
        t: 'ol',
        items: [
          'Can you import your menu from a spreadsheet yourself? If yes, most of what setup fees cover is work you can do in an afternoon.',
          'Is training on-site or a recorded video? On-site training for a team of six has real value. A link to a video does not.',
        ],
      },
      { t: 'h2', text: 'Modules that are quoted separately' },
      {
        t: 'p',
        text: 'This is where two quotes diverge most. Commonly unbundled:',
      },
      {
        t: 'table',
        head: ['Module', 'Why it gets unbundled'],
        rows: [
          ['Inventory and recipe costing', 'Sold as a premium tier because it is what larger kitchens ask for'],
          ['QR ordering / digital menu', 'Often priced per table or as an add-on subscription'],
          ['Loyalty and coupons', 'Frequently a separate product with its own fee'],
          ['Advanced reports', 'Basic sales included; margin, GST and operations reports gated'],
          ['Customer-facing app', 'Sometimes a separate build fee plus monthly'],
          ['Extra staff logins', 'Priced per user beyond a small included count'],
        ],
      },
      {
        t: 'p',
        text: 'Work out which of these you will genuinely use in the first six months, and price only those. It is easy to be sold a bundle on the argument that you will grow into it.',
      },
      { t: 'h2', text: 'Hardware' },
      {
        t: 'p',
        text: 'Independent of the software, and often the larger first-year number:',
      },
      {
        t: 'ul',
        items: [
          '**Billing device.** A basic laptop or desktop, or a tablet. Browser-based systems run on what you already have; some vendors require a specific terminal.',
          '**Thermal printer.** A 58mm or 80mm receipt printer. USB models are cheapest and the least troublesome; network models cost more and are easier to share.',
          '**Kitchen screen.** An inexpensive Android tablet and a wall mount, if you are replacing paper tickets.',
          '**Cash drawer, scanner, UPS.** Optional, and worth costing separately.',
        ],
      },
      {
        t: 'p',
        text: 'Be wary of hardware bundles that only work with one vendor\'s software. That is not a discount, it is a switching cost you are paying upfront.',
      },
      { t: 'h2', text: 'Payment charges' },
      {
        t: 'p',
        text: 'Separate from your POS subscription and paid to your payment gateway or bank. UPI merchant transactions currently carry no MDR for most merchants, while cards and wallets do. Confirm current rates with your gateway rather than with the POS vendor, and check whether the POS charges anything of its own on top for processing payments — some do.',
      },
      { t: 'h2', text: 'The cost nobody quotes: switching later' },
      {
        t: 'p',
        text: 'If a system does not let you export your sales history, menu and customer list in a normal format, the real cost of that system includes never being able to leave it cheaply. Test the export during the trial, not at the end.',
      },
      { t: 'h2', text: 'A sane way to budget' },
      {
        t: 'p',
        text: 'For a single independent café in India, a workable first-year budget is: a modest monthly subscription on the plan that covers only what you will use, a thermal printer, a device you probably already own, and nothing else until you have run three months and know what is missing. Buy the smallest plan that works, and upgrade against a real problem rather than a projected one.',
      },
    ],
    faqs: [
      {
        q: 'Is free restaurant POS software worth using?',
        a: 'Free tiers are usually genuinely usable for very low volumes, but check three things: whether your data is exportable, whether the free tier is funded by taking a percentage of your payments, and what happens to your history if you stop qualifying for it. A free plan you cannot leave is expensive.',
      },
      {
        q: 'Do I pay per outlet or per billing screen?',
        a: 'It varies by vendor and it is the single biggest source of surprise on renewal. Ask directly what happens to the price when you add a second billing screen in the same restaurant, and get the answer in writing.',
      },
      {
        q: 'Does restaurant POS software charge commission on sales?',
        a: 'Some do, particularly where ordering or payments are bundled in. A percentage of sales scales with your success in a way a flat subscription does not, so it is worth checking even when the headline monthly fee looks low. KhaoPiyo charges a flat subscription and no commission.',
      },
    ],
    related: [
      { label: 'How to choose restaurant POS software', href: '/blog/how-to-choose-restaurant-pos-software' },
      { label: 'KhaoPiyo pricing', href: '/pricing' },
      { label: 'GST billing for restaurants', href: '/blog/gst-billing-for-restaurants' },
    ],
  },

  {
    slug: 'gst-billing-for-restaurants',
    title: 'GST Billing for Restaurants: A Practical Guide',
    h1: 'GST billing for restaurants, in practice',
    description:
      'What a compliant restaurant GST invoice needs, how the restaurant rate and input tax credit work, and the billing mistakes that cause trouble at filing time.',
    keywords: [
      'GST billing for restaurants', 'restaurant GST invoice format', 'GST rate on restaurant food',
      'restaurant GST rules India', 'GST billing software restaurant',
    ],
    published: '2026-08-11',
    readingMinutes: 8,
    excerpt:
      'Most restaurant GST problems are not tax problems. They are billing problems that only become visible three months later, at filing time.',
    body: [
      {
        t: 'note',
        text: 'This is a practical guide written for restaurant owners, not tax advice. GST rates and rules are revised periodically. Confirm anything here against the current notifications or with your chartered accountant before acting on it. Last reviewed August 2026.',
      },
      {
        t: 'p',
        text: 'The GST that a restaurant charges is one of the simpler parts of Indian indirect tax. The trouble almost never comes from the rate. It comes from invoices: numbering that resets or skips, tax computed on the wrong base after a discount, HSN or SAC codes missing, and a month of bills that cannot be reconciled against the return because the POS and the register disagree.',
      },
      { t: 'h2', text: 'The rate, in outline' },
      {
        t: 'p',
        text: 'Standalone restaurants in India are generally taxed at a concessional rate on food and beverage service, charged as CGST plus SGST — and crucially, without input tax credit on purchases. Restaurants located inside hotels above a specified room-tariff threshold fall into a higher rate bracket where input tax credit is available. Alcohol is outside GST entirely and is taxed under state excise and VAT, which is why a bar bill carries two different tax treatments on one piece of paper.',
      },
      {
        t: 'p',
        text: 'Two consequences follow, and they matter more than the exact percentages:',
      },
      {
        t: 'ol',
        items: [
          '**No input tax credit means GST on your purchases is a cost, not a wash.** The tax you pay on packaging, ingredients and equipment does not come back. It belongs in your food-cost maths, not outside it.',
          '**Alcohol has to be separated at the line level.** A billing system that applies one tax rate to the whole bill will produce a wrong invoice for any table that ordered a drink.',
        ],
      },
      { t: 'h2', text: 'What a compliant tax invoice has to carry' },
      {
        t: 'p',
        text: 'If you are GST-registered, the invoice you hand a guest is a legal document, not a receipt. It generally needs:',
      },
      {
        t: 'ul',
        items: [
          'Your registered business name, address and GSTIN.',
          'A **consecutive invoice number**, unique within the financial year, with no gaps and no reuse.',
          'The date of issue.',
          'A description of each item, quantity and taxable value.',
          'The HSN or SAC code, where applicable to your turnover.',
          'The rate and amount of CGST and SGST shown separately, not as one combined figure.',
          'The total, in figures.',
        ],
      },
      {
        t: 'p',
        text: 'The sequential numbering requirement is the one that trips up restaurants most often, and it is entirely a software problem. If your billing system numbers invoices per device, or restarts numbering when you reinstall it, or lets a cancelled bill silently consume a number, you will have a sequence that cannot be explained. Numbering should be issued centrally, in one series, and a cancelled invoice should remain in the series as a cancelled invoice rather than disappearing.',
      },
      { t: 'h2', text: 'Discounts and the taxable value' },
      {
        t: 'p',
        text: 'A discount given at the time of sale and shown on the invoice reduces the taxable value. That sounds obvious and is where a large share of restaurant billing errors live, because it means a discount cannot be applied after tax as a round number off the total — it has to be applied to the line values, with tax then computed on what is left.',
      },
      {
        t: 'p',
        text: 'For a bill with several items at different prices, the discount has to be spread across those lines so each line has its own taxable value. Software should do this and show it. If your system just subtracts ₹100 from the grand total, your per-line taxable values no longer add up to the invoice, and your GST report will not reconcile.',
      },
      { t: 'h2', text: 'Service charge is not a tax' },
      {
        t: 'p',
        text: 'Service charge is a charge the restaurant levies, not a government levy, and consumer guidance in India has been explicit that it cannot be added automatically or made mandatory. Whatever you decide about levying it, it must never appear on a bill in a way that a guest could mistake for GST. Keep it a clearly separate, clearly labelled line.',
      },
      { t: 'h2', text: 'The five billing mistakes that cost the most' },
      {
        t: 'ol',
        items: [
          '**Invoice numbers that reset or skip.** Usually caused by per-device numbering or a reinstall. Central numbering fixes it permanently.',
          '**Discounts applied after tax.** Produces per-line taxable values that do not sum to the invoice total.',
          '**No line-level tax split.** Fine until the first table orders alcohol, then wrong every time.',
          '**Cancelled bills vanishing.** A cancellation should be recorded, with a reason and a person attached, not deleted.',
          '**Reports built from orders instead of invoices.** An order is a working document; the invoice is what you file against. They diverge the moment anything is cancelled or refunded.',
        ],
      },
      { t: 'h2', text: 'What to check in your own system tonight' },
      {
        t: 'p',
        text: 'Three checks, ten minutes:',
      },
      {
        t: 'ol',
        items: [
          'Pull the last fifty invoice numbers. Is the sequence unbroken?',
          'Ring up a two-item bill with a discount, and check whether the two taxable values plus tax equal the total on the printed invoice.',
          'Open your GST report for last month and compare the total taxable value against your sales report. If they differ, find out why before your accountant does.',
        ],
      },
      {
        t: 'p',
        text: 'KhaoPiyo issues invoice numbers centrally in one sequence, splits CGST and SGST per line, allocates discounts proportionally across lines before computing tax, and produces a GST report on an invoice basis — the details are on the [GST billing page](/gst-billing-software-for-restaurants). Whatever you use, run the three checks above against it.',
      },
    ],
    faqs: [
      {
        q: 'Does a restaurant have to issue a GST invoice for every bill?',
        a: 'A GST-registered restaurant must issue a tax invoice for taxable supplies, including to unregistered walk-in customers, though a consolidated invoice is permitted for small-value supplies in certain circumstances. The practical answer for a restaurant is to issue a properly numbered invoice for every bill — it is simpler than tracking exceptions and it keeps the sequence clean.',
      },
      {
        q: 'Can restaurant invoice numbers restart every year?',
        a: 'The requirement is a consecutive series unique within a financial year, so starting a fresh series at the beginning of a financial year is normal. What causes problems is a series that restarts mid-year, runs separately per billing device, or skips numbers.',
      },
      {
        q: 'How should a discount be shown on a restaurant GST invoice?',
        a: 'A discount given at the time of sale should reduce the taxable value, which means it needs to be applied to the item lines before GST is computed rather than deducted from the final total. Each line then carries its own reduced taxable value and its own tax amount.',
      },
      {
        q: 'Is GST charged on service charge?',
        a: 'Service charge is a restaurant levy rather than a tax, and where it is levied it generally forms part of the value of the supply. Because guidance on levying it at all has been contested, treat it carefully and take your accountant\'s view — but never present it on a bill in a way that resembles a government tax.',
      },
    ],
    related: [
      { label: 'GST billing software for restaurants', href: '/gst-billing-software-for-restaurants' },
      { label: 'What POS software costs in India', href: '/blog/restaurant-pos-software-cost-india' },
      { label: 'How to reduce food cost in a café', href: '/blog/how-to-reduce-food-cost-in-a-cafe' },
    ],
  },

  {
    slug: 'does-qr-ordering-work-for-restaurants',
    title: 'Does QR Ordering Actually Work for Restaurants?',
    h1: 'Does QR ordering actually work for restaurants?',
    description:
      'An honest look at QR code ordering in Indian restaurants — where it genuinely helps, where it annoys guests, and how to roll it out without losing table service.',
    keywords: [
      'QR code ordering restaurants', 'QR menu ordering India', 'scan and order restaurant',
      'contactless ordering restaurant', 'table QR ordering system',
    ],
    published: '2026-08-11',
    readingMinutes: 7,
    excerpt:
      'QR ordering is neither the revolution it was sold as in 2021 nor the gimmick the backlash made it. It works in specific situations. Here are those situations.',
    body: [
      {
        t: 'p',
        text: 'QR ordering arrived in Indian restaurants as a pandemic necessity, was oversold as the future of dining, and then collected a backlash — guests complaining about squinting at a PDF, restaurants finding it made service worse rather than better. Both waves were about implementation, not the idea.',
      },
      {
        t: 'p',
        text: 'The useful question is narrower: in which situations does a guest ordering from their own phone actually beat a person taking the order?',
      },
      { t: 'h2', text: 'Where it clearly wins' },
      {
        t: 'h3', text: 'The second round',
      },
      {
        t: 'p',
        text: 'This is the strongest case and the one most often missed. Taking the first order is a service moment worth having a person for. Getting a second coffee, an extra portion of fries or the bill twenty minutes later is not — it is a guest trying to catch someone\'s eye across a busy room. QR ordering turns that into three taps, and it is exactly the order that gets lost otherwise.',
      },
      {
        t: 'h3', text: 'Peak-hour counters',
      },
      {
        t: 'p',
        text: 'When there is a queue, every guest who orders from their table is one fewer person in it. The bottleneck at a busy café is usually order-taking, not the kitchen.',
      },
      {
        t: 'h3', text: 'Understaffed shifts',
      },
      {
        t: 'p',
        text: 'A Sunday with one person short is where QR ordering earns its keep — not by replacing a server, but by making an eight-table section survivable.',
      },
      {
        t: 'h3', text: 'Menus that need explaining',
      },
      {
        t: 'p',
        text: 'A photograph, a description, a veg marker and a visible add-on list do a job a laminated card cannot. Guests order more confidently when they can see what a dish is.',
      },
      { t: 'h2', text: 'Where it genuinely fails' },
      {
        t: 'ul',
        items: [
          '**Fine dining and anywhere service is the product.** If a guest is paying for attention, removing the person is removing what they bought.',
          '**A PDF instead of a menu.** A scanned image that has to be pinch-zoomed is worse than paper in every way. If the menu is not a real, item-by-item mobile page, do not deploy it.',
          '**Older guests and large groups.** Both need a person. Any QR rollout has to keep the option of ordering the normal way, always, without it feeling like a concession.',
          '**Weak signal.** A café in a basement with no mobile data and slow Wi-Fi will produce a guest staring at a loading spinner. Fix the connectivity first.',
          '**Forcing an app install or a long signup.** Every extra screen loses guests. Ordering should need a name and a number at most.',
        ],
      },
      { t: 'h2', text: 'What separates a good implementation from a bad one' },
      {
        t: 'ol',
        items: [
          '**It is the same menu the counter uses.** If the QR menu is a separate copy, it will drift out of date and a guest will order something that ran out at lunch.',
          '**Sold out means sold out, immediately.** Marking an item unavailable has to reach the guest\'s phone at once.',
          '**The order goes straight to the kitchen.** If someone at the counter has to re-key it, you have added a step rather than removed one.',
          '**The table number comes with the order.** Obvious, and routinely got wrong.',
          '**It loads in seconds on a mediocre connection.** Lazy-loaded images and a cached menu, not a heavy page.',
          '**Paying is optional.** Some guests will pay online; many want to pay at the counter. Both have to work.',
        ],
      },
      { t: 'h2', text: 'How to roll it out without a mess' },
      {
        t: 'p',
        text: 'Do not put a QR on every table on day one. A sequence that works:',
      },
      {
        t: 'ol',
        items: [
          'Start with four tables, ideally the ones furthest from the counter.',
          'Keep taking orders normally at every other table.',
          'Watch what breaks for two weeks — usually item descriptions, not the technology.',
          'Ask the staff, not the guests, whether it made the shift easier. Staff notice first.',
          'Expand only if the answer is yes.',
        ],
      },
      {
        t: 'p',
        text: 'And keep the framing right with guests: the QR is an option, not a replacement. A table tent that says "scan to order, or just wave — either works" converts far better than one that implies nobody is coming.',
      },
      { t: 'h2', text: 'The honest summary' },
      {
        t: 'p',
        text: 'QR ordering is a genuine improvement for repeat orders, peak hours and short-staffed shifts, and a genuine downgrade for anywhere service is the point. It is worth doing if — and only if — the menu is a real mobile page tied to the same data your counter uses, and ordering the old way stays available. KhaoPiyo\'s implementation is described on the [QR ordering page](/qr-code-ordering-system); the criteria above apply to any of them.',
      },
    ],
    faqs: [
      {
        q: 'Do guests actually use QR ordering, or do they still ask for a server?',
        a: 'Both, and a good setup expects both. Usage is highest for second rounds and at tables far from the counter, and lowest with large groups and guests who would rather talk to someone. Any rollout that removes the option of ordering from a person will generate complaints.',
      },
      {
        q: 'Does QR ordering need guests to install an app?',
        a: 'It should not. Scanning should open a web page in the phone\'s browser. Requiring an app install loses most guests at the first screen and is the most common reason a QR rollout fails.',
      },
      {
        q: 'Can guests pay through the QR menu, or only order?',
        a: 'Either, depending on how you configure it. Many Indian cafés take the order digitally but settle at the counter, which avoids gateway charges and keeps a moment of contact at the end of the meal. Online payment is worth enabling for takeaway and busy peaks.',
      },
    ],
    related: [
      { label: 'QR code ordering system', href: '/qr-code-ordering-system' },
      { label: 'Kitchen display vs KOT printer', href: '/blog/kitchen-display-system-vs-kot-printer' },
      { label: 'Digital menu software', href: '/digital-menu-software' },
    ],
  },

  {
    slug: 'how-to-reduce-food-cost-in-a-cafe',
    title: 'How to Reduce Food Cost in a Café',
    h1: 'How to reduce food cost in a café without changing the menu',
    description:
      'Practical food cost control for small cafés: how to measure cost per dish properly, find the items losing money, and cut waste using data you already have.',
    keywords: [
      'reduce food cost restaurant', 'food cost percentage cafe', 'restaurant food costing',
      'recipe costing software', 'control food cost India',
    ],
    published: '2026-08-11',
    readingMinutes: 8,
    excerpt:
      'Most cafés know their food cost as a single percentage of revenue. That number hides everything worth acting on.',
    body: [
      {
        t: 'p',
        text: 'Ask a café owner their food cost and you usually get one number — thirty per cent, thirty-five, sometimes "about a third". It is a real number and it is nearly useless, because it is an average across dishes with wildly different economics. A café at 32% overall can easily contain a signature item at 55% that sells forty a day, and a drink at 12% that sells four.',
      },
      {
        t: 'p',
        text: 'Reducing food cost is mostly a measurement problem before it is a purchasing problem. Here is the sequence that works, in order.',
      },
      { t: 'h2', text: 'Step 1: Cost your ten best-selling dishes properly' },
      {
        t: 'p',
        text: 'Not the whole menu. Ten. In most cafés the top ten items are the large majority of covers, and costing them accurately gets you nearly all of the benefit of costing everything.',
      },
      {
        t: 'p',
        text: 'For each one, write the recipe as quantities, not descriptions: 180ml milk, 18g coffee, 1 paper cup, 1 lid, 1 sleeve. Then price each line from your last purchase invoice, not from memory. Include:',
      },
      {
        t: 'ul',
        items: [
          'Packaging, which is routinely forgotten and is material on takeaway-heavy menus.',
          'Anything given away with the dish — sauces, a side salad, a mint.',
          'GST paid on ingredients if you are on the concessional restaurant rate without input tax credit, because that tax is a real cost to you and does not come back.',
          'A realistic wastage allowance on anything perishable.',
        ],
      },
      {
        t: 'p',
        text: 'That last one matters. A dish using an ingredient you throw away a fifth of costs 25% more than its recipe suggests.',
      },
      { t: 'h2', text: 'Step 2: Put cost next to sales volume' },
      {
        t: 'p',
        text: 'Now cross the cost figures with how often each item sells. Four quadrants, and each one has a different action:',
      },
      {
        t: 'table',
        head: ['', 'Sells a lot', 'Sells rarely'],
        rows: [
          ['High margin', 'Protect it. Do not touch the recipe or the price.', 'Promote it. Move it up the menu, suggest it at the counter.'],
          ['Low margin', 'Fix it — this is where the money is. Reprice, resize or re-source.', 'Cut it. It costs prep, stock and menu space for nothing.'],
        ],
      },
      {
        t: 'p',
        text: 'The high-volume low-margin box is where nearly all recoverable money sits. A ₹12 improvement on an item selling fifty a day is ₹18,000 a month. The same ₹12 on an item selling twice a day is ₹720 and not worth the effort.',
      },
      { t: 'h2', text: 'Step 3: Fix the expensive items in the right order' },
      {
        t: 'p',
        text: 'Four levers, roughly in order of how well they hold up:',
      },
      {
        t: 'ol',
        items: [
          '**Portion discipline.** The cheapest fix and the most reliable. Weigh the protein and the cheese for a week. Most kitchens are over-portioning by ten to twenty per cent without knowing it, and a scale on the line costs almost nothing.',
          '**Re-sourcing.** Same specification, different supplier or pack size. Worth doing on your top three ingredients by spend, not on everything.',
          '**Recipe change.** A cheaper component or a smaller quantity of an expensive one. Effective, but it changes the dish — test it before rolling it out.',
          '**Price increase.** Works, and guests notice. Save it for items where the cost has genuinely moved, and change several prices at once rather than nudging one item repeatedly.',
        ],
      },
      { t: 'h2', text: 'Step 4: Close the gap between theoretical and actual' },
      {
        t: 'p',
        text: 'Once recipes are costed, your system can calculate what you *should* have used: sales multiplied by recipe. Compare that with what you actually bought and counted, and the difference is waste, theft, over-portioning or miscounted stock. Chase the biggest gap, not all of them.',
      },
      {
        t: 'p',
        text: 'This is the single most valuable number in food cost control and almost nobody small tracks it, because it needs recipes attached to menu items and stock that moves when you sell. That is exactly what recipe-linked inventory does — selling a dish deducts its components, so the theoretical figure maintains itself. KhaoPiyo does this on its [inventory module](/restaurant-inventory-management-software); the principle applies whatever you use, including a spreadsheet.',
      },
      { t: 'h2', text: 'Step 5: Attack waste where it actually happens' },
      {
        t: 'p',
        text: 'In a small café, waste concentrates in a few predictable places:',
      },
      {
        t: 'ul',
        items: [
          '**Prep for a busier day than you got.** Prep against last week\'s same weekday, not against a hopeful average.',
          '**Perishables ordered in supplier pack sizes.** If a case is more than you use before it turns, split the order or change the item.',
          '**Remakes.** Every returned dish is double cost. If one dish gets remade often, the problem is a recipe or a station, not the guest.',
          '**Staff meals with no rules.** Legitimate and worth having — but they should be a defined meal, not open access to the line.',
          '**Cancelled orders after prep started.** Track these. If the number is high, the problem is usually order timing, not customers changing their minds.',
        ],
      },
      { t: 'h2', text: 'What good looks like' },
      {
        t: 'p',
        text: 'You do not need a target percentage — those vary enormously by format and are more useful for comparing yourself to yourself than to anyone else. What you need is: recipes costed for your top items, per-item margin visible without doing maths, the gap between theoretical and actual usage tracked monthly, and one specific item being worked on at any given time.',
      },
      {
        t: 'p',
        text: 'A café that does those four things will find several per cent of margin in the first quarter, almost always from two or three dishes nobody suspected.',
      },
    ],
    faqs: [
      {
        q: 'What is a good food cost percentage for a café in India?',
        a: 'It varies too much by format for a single benchmark to be useful — a coffee-led café and a full-menu kitchen have completely different economics. A more useful measure is your own trend month to month, plus per-item margin, which tells you where to act. A single blended percentage tells you something changed but never what.',
      },
      {
        q: 'How do I calculate the cost of a dish?',
        a: 'Write the recipe as measured quantities rather than descriptions, price each line from your most recent purchase invoice, and add packaging, any giveaways, wastage on perishables, and the GST you paid on ingredients if you cannot claim input tax credit. The result is the true cost; subtract it from the selling price for real margin.',
      },
      {
        q: 'Does POS software help reduce food cost?',
        a: 'Indirectly but substantially, if it links recipes to menu items. That link lets it calculate margin per dish automatically and compute theoretical usage from sales, which is the number that exposes waste and over-portioning. Without recipe linkage, a POS only tells you what sold, not what it cost you.',
      },
    ],
    related: [
      { label: 'Inventory management software', href: '/restaurant-inventory-management-software' },
      { label: 'GST billing for restaurants', href: '/blog/gst-billing-for-restaurants' },
      { label: 'How to choose restaurant POS software', href: '/blog/how-to-choose-restaurant-pos-software' },
    ],
  },

  {
    slug: 'kitchen-display-system-vs-kot-printer',
    title: 'Kitchen Display System vs KOT Printer',
    h1: 'Kitchen display system vs KOT printer: which does a café need?',
    description:
      'A straight comparison of kitchen display screens and printed KOT tickets — cost, reliability, what each one does when things go wrong, and when running both makes sense.',
    keywords: [
      'kitchen display system vs KOT printer', 'KDS vs kitchen printer', 'KOT printer restaurant',
      'kitchen display system India', 'digital KOT',
    ],
    published: '2026-08-11',
    readingMinutes: 6,
    excerpt:
      'The paper ticket has one real advantage over a screen, and it is not the one usually cited. Here is the comparison without the sales pitch.',
    body: [
      {
        t: 'p',
        text: 'Every café eventually has to decide how orders reach the kitchen: a printed KOT ticket, a screen, or both. The argument is usually framed as old versus modern, which is not a useful frame. They fail differently, and which failure you can tolerate is the actual decision.',
      },
      { t: 'h2', text: 'The comparison' },
      {
        t: 'table',
        head: ['', 'KOT printer', 'Kitchen display'],
        rows: [
          ['Upfront cost', 'Printer, roughly ₹2,000–₹8,000', 'A tablet you may already own, plus a mount'],
          ['Running cost', 'Paper rolls, ongoing', 'Electricity'],
          ['Works without internet', 'Only if the POS is also offline-capable', 'No — needs a connection to receive orders'],
          ['Runs out mid-service', 'Yes, paper and ribbon', 'No consumables'],
          ['Shows elapsed time', 'No — the ticket says when, not how long', 'Yes, and it keeps counting'],
          ['Order can be modified after sending', 'No, the paper is already wrong', 'Yes, the screen reflects the current order'],
          ['Survives a wet or greasy hand', 'Yes, and it is disposable', 'Depends on the tablet and the mount'],
          ['Leaves a timing record', 'No', 'Yes — turnaround becomes measurable'],
        ],
      },
      { t: 'h2', text: 'The real advantage of paper' },
      {
        t: 'p',
        text: 'It is not reliability — printers jam and run out constantly. It is that a paper ticket is **physical and movable**. A cook can put it on the rail, move it along as the dish progresses, hand it to the next station, and spike it when it goes out. That physical workflow carries information that a shared screen does not: which tickets are mine, which are in progress, which are waiting on the fryer.',
      },
      {
        t: 'p',
        text: 'In a multi-station kitchen with a clear rail discipline, that is a genuine advantage and it is why serious kitchens with good systems still use paper. A screen has to earn its place against that, not against a strawman.',
      },
      { t: 'h2', text: 'The real advantage of a screen' },
      {
        t: 'p',
        text: 'Also not the obvious one. The advantage is not that it is paperless — it is that **it knows the time**.',
      },
      {
        t: 'p',
        text: 'A paper ticket tells you when the order was placed. A screen tells you it has been eighteen minutes and puts a red outline on it. That difference changes behaviour at the pass: instead of noticing a late order when the guest asks, the kitchen notices at eight minutes, while it is still recoverable. It is the single biggest operational reason to use a screen, and it is worth more in a small kitchen than in a large one, because in a small kitchen nobody is watching the rail full-time.',
      },
      {
        t: 'p',
        text: 'The secondary advantage is that every ticket cleared produces a data point. After a month you can say what your actual turnaround is by hour, rather than what it feels like.',
      },
      { t: 'h2', text: 'What each does when things go wrong' },
      {
        t: 'h3', text: 'The internet drops' },
      {
        t: 'p',
        text: 'A cloud POS cannot bill either way, so the kitchen is not usually the binding constraint. What matters is what the kitchen sees: a good display keeps the last board on screen and says clearly that it is offline, rather than going blank and making cooks think orders vanished.',
      },
      {
        t: 'h3', text: 'The printer runs out of paper' },
      {
        t: 'p',
        text: 'Orders stop arriving and nobody notices for several minutes, because the failure is silent from both ends — the counter thinks it printed, the kitchen has nothing to look at. This is the most common serious KOT failure and it has no equivalent on a screen.',
      },
      {
        t: 'h3', text: 'The tablet dies' },
      {
        t: 'p',
        text: 'Any other device with a browser becomes the kitchen screen in about a minute, which is the compensating advantage. Keep a charger permanently plugged in — a screen at 4% during dinner service is the failure mode to plan for.',
      },
      { t: 'h2', text: 'Running both' },
      {
        t: 'p',
        text: 'This is what a lot of cafés settle on, and it is not a fudge. The screen is the source of truth for what is outstanding and how long it has been waiting; the printed ticket, where it is used, is a working aid for a station that wants something in hand. If you do this, be clear which one is authoritative — a kitchen where half the orders are on paper and half on screen is worse than either alone.',
      },
      { t: 'h2', text: 'A reasonable default' },
      {
        t: 'p',
        text: 'For a small café with one kitchen area and no station separation: start with the screen alone. It is cheaper to run, it cannot silently stop, and the timers change behaviour immediately. Add a printer later if a specific station asks for one.',
      },
      {
        t: 'p',
        text: 'For a multi-station kitchen with an existing rail workflow that works: keep the paper, and add a screen for the timing and the record rather than to replace the tickets.',
      },
      {
        t: 'p',
        text: 'KhaoPiyo supports both — the [kitchen display](/kitchen-display-system) needs no printer at all, and KOT tickets can be printed to a 58mm or 80mm thermal printer where a station wants paper.',
      },
    ],
    faqs: [
      {
        q: 'Is a kitchen display system better than a KOT printer?',
        a: 'For most small cafés, yes — it has no consumables to run out of, shows how long each order has been waiting, and leaves a timing record. A paper ticket keeps one real advantage: it is physical, so it can be moved along a rail between stations. Multi-station kitchens with a working rail discipline often keep both.',
      },
      {
        q: 'What hardware do I need for a kitchen display system?',
        a: 'A browser-based KDS needs only a screen — an inexpensive Android tablet, an old laptop or a monitor on a spare computer — plus a wall mount and a charger left permanently connected. There is no dedicated terminal to buy.',
      },
      {
        q: 'Can I run a kitchen display and a KOT printer together?',
        a: 'Yes, and many kitchens do. The important thing is deciding which one is authoritative for what is outstanding, so that orders are not half-tracked in each. Usually the screen is the source of truth and paper is a station-level working aid.',
      },
    ],
    related: [
      { label: 'Kitchen display system', href: '/kitchen-display-system' },
      { label: 'Does QR ordering work for restaurants?', href: '/blog/does-qr-ordering-work-for-restaurants' },
      { label: 'POS and billing software', href: '/pos-billing-software' },
    ],
  },
  {
  "slug": "qr-ordering-reduce-table-service-time",
  "title": "How QR Ordering Cuts Table Service Time in Cafés",
  "h1": "Where QR Ordering Actually Saves Time in Table Service",
  "description": "A minute-by-minute look at where QR ordering shortens a café's service timeline — and the parts of service it doesn't touch at all.",
  "keywords": [
    "QR ordering table service time",
    "reduce table turnover cafe",
    "QR code ordering speed restaurant",
    "faster table service POS",
    "QR menu ordering system cafe India"
  ],
  "published": "2026-09-10",
  "readingMinutes": 8,
  "excerpt": "QR ordering doesn't make food cook faster — it removes three specific waits from the service timeline. Here's exactly which ones, with a before-and-after walkthrough.",
  "body": [
    {
      "t": "p",
      "text": "Most articles about QR ordering answer one question: does it work, and should a café bother with it. That ground is already covered on this site — see [does QR ordering actually work for restaurants](/blog/does-qr-ordering-work-for-restaurants) if that's what you're deciding. This piece assumes you've already decided it's worth trying, and answers a narrower, more useful question: where in the actual service timeline does it save time, and where does it not?"
    },
    {
      "t": "p",
      "text": "That distinction matters because \"QR ordering saves time\" is a claim owners hear a lot and rarely see broken down. Some of it is true, some of it is overstated, and a chunk of the real saving depends on whether the order actually reaches the kitchen instantly or just moves the same delay from a waiter's notepad to a phone screen."
    },
    {
      "t": "h2",
      "text": "What \"table service\" actually breaks into"
    },
    {
      "t": "p",
      "text": "Table service isn't one block of time — it's a chain of small handoffs, and each handoff has its own wait built in. A guest gets seated, gets a menu, decides what to order, gets that order captured by someone, has that order physically or digitally reach the kitchen, waits for it to be cooked, gets it served, orders again if they want more, asks for the bill, and pays. QR ordering only touches some of those links."
    },
    {
      "t": "table",
      "head": [
        "Step in the timeline",
        "Typical wait, paper + waiter",
        "Typical wait, QR ordering at table"
      ],
      "rows": [
        [
          "Guest seated to menu in hand",
          "2–4 min (waiting for a free waiter)",
          "0 min — menu is already at the table"
        ],
        [
          "Deciding what to order",
          "2–4 min",
          "2–4 min — unchanged, this is a human decision"
        ],
        [
          "Order captured",
          "2–5 min (waiter has to be free and reach the table)",
          "Under 1 min — order is placed the moment the guest is ready"
        ],
        [
          "Order reaches the kitchen",
          "1–3 min (waiter walks it to the counter or writes a KOT)",
          "Instant, if the system pushes straight to a kitchen display"
        ],
        [
          "Adding a second round or a side dish",
          "3–6 min (wait for the waiter again)",
          "Under 1 min — added to the same running order"
        ],
        [
          "Bill requested to payment closed",
          "3–8 min (ask for the bill, wait, pay, wait for change)",
          "1–3 min if paying by UPI at the table or counter"
        ]
      ]
    },
    {
      "t": "p",
      "text": "Add that up and the honest picture is: cooking time never changes, but somewhere between 8 and 15 minutes of waiting-on-a-person time can come out of a typical two-course table visit, concentrated in three specific spots."
    },
    {
      "t": "h2",
      "text": "The three places QR ordering actually removes time"
    },
    {
      "t": "ul",
      "items": [
        "Order capture — the guest doesn't wait for a waiter to be free, walk over, and write the order down. They order the moment they're ready, even if every waiter on the floor is busy with another table.",
        "Order transmission — a QR order that's properly integrated goes straight to the kitchen the second it's placed. No one has to carry a slip, key it into a POS, or shout it across a pass.",
        "Repeat and add-on orders — this is the one owners underestimate. A table that orders a starter, then decides on a second cold coffee ten minutes later, doesn't need to flag anyone down. That second order is often the slowest one in a paper-based system because the waiter is now busy elsewhere."
      ]
    },
    {
      "t": "h3",
      "text": "Order transmission is where most of the theoretical saving gets lost"
    },
    {
      "t": "p",
      "text": "Here's the part that trips people up: having a QR menu doesn't automatically mean the order reaches the kitchen faster. If the order lands on a tablet at the billing counter and someone still has to manually re-key it or print a slip and walk it over, you've just moved the bottleneck, not removed it. The saving only shows up when the order goes straight to a [kitchen display system](/kitchen-display-system) the kitchen is actually watching. The difference between a screen the kitchen glances at continuously and a printer that spits out slips someone has to physically collect is bigger than it sounds — it's covered in more depth in [KDS vs KOT printer](/blog/kitchen-display-system-vs-kot-printer)."
    },
    {
      "t": "h2",
      "text": "A before-and-after walkthrough for a 20-table café"
    },
    {
      "t": "p",
      "text": "Take a Saturday evening rush: 20 tables, three waiters, a kitchen running on a mix of memory and shouted tickets. A table of four gets seated. In a paper-and-waiter setup, they wait a few minutes for a waiter to notice them, place a starter and two drinks, the waiter finishes two other tables before writing the ticket and walking it to the kitchen, and the kitchen starts on it roughly 6–8 minutes after the guests actually decided what they wanted. Twenty minutes later the table wants a second round of drinks — same wait, same walk, another 5–6 minutes before that reaches the kitchen."
    },
    {
      "t": "p",
      "text": "With QR ordering feeding a kitchen display directly, the first order hits the kitchen within seconds of the guest confirming it, regardless of how busy the waiters are. The second round of drinks is the same: tapped, sent, cooking starts immediately. The waiter's job shifts from being the only channel an order can travel through to handling exceptions — a guest who wants to modify a dish, someone who needs a recommendation, a table that prefers to just tell a person. That's also where [waiter tableside quick-add](/pos-billing-software) matters: staff can still punch in an order directly for tables that don't want to use a phone, without it being a separate, disconnected process from the QR orders hitting the same kitchen screen."
    },
    {
      "t": "h2",
      "text": "What QR ordering does not speed up"
    },
    {
      "t": "p",
      "text": "Being fair about the limits matters more than the sales pitch. QR ordering does nothing for:"
    },
    {
      "t": "ul",
      "items": [
        "Actual cook time — a dish that takes 12 minutes on a tawa still takes 12 minutes, no matter how the order arrived.",
        "Plating and food running to the table — someone still has to carry the plate over, unless the café also runs food runners efficiently.",
        "A guest who wants to chat, ask for recommendations, or needs help — QR ordering removes a wait, it doesn't remove the value of a person at the table.",
        "Payment, if the café has no fast payment path — a QR order followed by cash-and-change at the counter saves nothing at the billing stage."
      ]
    },
    {
      "t": "note",
      "text": "QR ordering is a genuine speed gain at the order-capture and order-transmission stages, and a real convenience at reorder time. It is not a kitchen speed-up or a magic fix for a short-staffed floor."
    },
    {
      "t": "h2",
      "text": "Where cafés get less benefit than they expect"
    },
    {
      "t": "p",
      "text": "Three patterns account for most of the disappointment when a café adopts QR ordering and doesn't see the saving they expected. First, the kitchen is still working off handwritten tickets or a shout, so the order sits in a queue at the same pace as before — the fix is a proper [kitchen display system](/kitchen-display-system), not just a QR code at the table. Second, the digital menu is disorganised or has too many sub-categories, so guests take longer to decide than they would scanning a printed card — a QR menu needs to be laid out for speed, not just digitised. Third, and most common: staff end up re-typing QR orders into a separate billing system because the ordering tool and the POS aren't the same product. If [POS billing](/pos-billing-software) and QR ordering don't share one order queue, you've added a screen without removing a step."
    },
    {
      "t": "h2",
      "text": "What to check before you pick a QR ordering system"
    },
    {
      "t": "p",
      "text": "If the goal is genuinely shorter service time, not just a QR code on the table, check for these before signing up:"
    },
    {
      "t": "ol",
      "items": [
        "Orders go straight to a kitchen display in real time — not a printed slip someone has to carry, and not a dashboard staff have to refresh.",
        "The same system handles POS billing, so an order placed by QR and an order punched in by a waiter both land in one queue, not two.",
        "Waiters can still add or modify items tableside for guests who don't want to use their phone — QR ordering should be an option, not a requirement.",
        "The system supports held orders and live table status, so a table that pauses mid-order or adds items later doesn't create confusion at the kitchen.",
        "GST invoicing is generated automatically from the same order, so billing doesn't become a second manual step after a fast QR order."
      ]
    },
    {
      "t": "p",
      "text": "This is exactly why QR ordering, POS billing, and kitchen display are bundled together on KhaoPiyo rather than sold as separate add-ons — a fast order that has to be re-entered somewhere else isn't actually fast. QR Ordering and Kitchen Display are included from the [Starter plan](/pricing) onward, along with POS billing and GST invoicing, so a café isn't paying extra just to connect the pieces that make the time-saving real."
    },
    {
      "t": "h2",
      "text": "The honest summary"
    },
    {
      "t": "p",
      "text": "QR ordering saves real time in three specific places — capturing the order, getting it to the kitchen, and handling reorders — and does nothing for cook time, food running, or a payment process that's still manual. The size of the saving depends almost entirely on whether the order goes straight from the guest's phone to a kitchen screen without a human re-entering it anywhere in between. Get that connection right and a busy Saturday evening genuinely moves faster. Get it wrong and you've just added a QR code to the same bottlenecks that were already there."
    }
  ],
  "faqs": [
    {
      "q": "Does QR ordering actually reduce table turnover time, or just order-taking time?",
      "a": "It primarily reduces order-taking and order-transmission time — the wait for a waiter to be free, and the delay before an order reaches the kitchen. Table turnover overall also improves somewhat because reorders happen faster and bill payment can be quicker with UPI, but cooking time and food-running time are unchanged, so total turnover gains are smaller than order-capture gains alone."
    },
    {
      "q": "Do I still need waiters if I switch to QR ordering?",
      "a": "Yes. QR ordering removes the wait for a waiter to take an order, but staff are still needed to run food to tables, help guests who prefer not to use their phone, handle exceptions like modified orders, and manage the floor generally. A good setup lets waiters add or edit orders tableside as well, so QR ordering is an additional channel into the kitchen, not a replacement for staff."
    },
    {
      "q": "Will QR ordering slow things down if my kitchen still uses handwritten tickets?",
      "a": "It can genuinely fall short of expectations, because the order still has to be read off a screen and written or shouted out manually, which reintroduces the delay QR ordering was meant to remove. The time saving from QR ordering depends on the order reaching a kitchen display in real time — pairing it with a proper kitchen display system is what makes the saving actually show up in the kitchen, not just at the table."
    }
  ],
  "related": [
    {
      "label": "Does QR Ordering Work for Restaurants?",
      "href": "/blog/does-qr-ordering-work-for-restaurants"
    },
    {
      "label": "Kitchen Display System vs KOT Printer",
      "href": "/blog/kitchen-display-system-vs-kot-printer"
    },
    {
      "label": "QR Code Ordering System",
      "href": "/qr-code-ordering-system"
    }
  ]
},

  {
  "slug": "cafe-pos-billing-gst-daily-operations",
  "title": "Café POS: Billing, GST & Daily Operations",
  "h1": "How a café POS handles billing, GST and daily operations",
  "description": "A shift-by-shift walkthrough of how a café POS handles till opening, billing, GST invoicing, payments, cash reconciliation and reports.",
  "keywords": [
    "cafe POS billing",
    "restaurant POS daily operations",
    "cash shift reconciliation POS",
    "GST invoicing POS software",
    "POS day close process",
    "cafe management software India"
  ],
  "published": "2026-09-10",
  "readingMinutes": 8,
  "excerpt": "From opening the cash float to counting the drawer at close, here's what a café POS actually does during a real shift — billing, discounts, GST invoicing and the reports in between.",
  "body": [
    {
      "t": "p",
      "text": "An 11am order for two cold coffees and a sandwich should take about fifteen seconds to bill. In a lot of cafés it takes closer to a minute, because the person at the counter is toggling between a paper KOT pad, a calculator for the GST split, and a notebook for the day's cash count. None of those steps are hard on their own. Stacked together across two hundred bills a day, they're where the afternoon goes."
    },
    {
      "t": "p",
      "text": "A café POS doesn't replace judgment — your staff still decide what to discount and when to comp a table. What it should do is collapse the mechanical parts of a shift — opening the till, billing, sending tickets to the kitchen, invoicing correctly, counting cash at the end — into steps that don't need a second person checking the math. Here's what that looks like across an actual day, from open to close."
    },
    {
      "t": "h2",
      "text": "Opening the till: starting a shift with a number you trust"
    },
    {
      "t": "p",
      "text": "Every shift should start with a declared cash float — say ₹2,000 in the drawer before the first bill. In a system with cash shift and drawer reconciliation built in, the person opening the counter logs that starting amount against their own staff login before taking a single order. It sounds like a formality, but it's the only thing that makes the day's closing count meaningful later — without a known starting number, a ₹300 shortfall at 10pm could be a billing error, a missed order, or just an open float nobody logged. With staff accounts and roles, that opening entry is tied to the person who did it, not to \"the counter\" in general, so if two people work the same shift on different logins, each one's cash movements stay separable."
    },
    {
      "t": "h2",
      "text": "Billing: the four hundred times a day part"
    },
    {
      "t": "p",
      "text": "This is where most of the shift actually lives. A table orders, a waiter or counter staff rings it up, and the bill needs to reflect exactly what was served — including the stuff that happens after the first tap. A customer adds a second lassi. Someone wants a discount because the espresso machine was slow that day. A table gets held because they're still deciding on dessert. POS billing that's actually built for a café (not adapted from a retail till) treats discounts and held orders as first-class actions, not workarounds — you don't need to void and rebill to fix a running order."
    },
    {
      "t": "p",
      "text": "Waiter tableside quick-add matters here too. If a waiter can add items to an existing table's order from where they're standing instead of walking back to the counter, that's one less trip per addition, and on a busy Saturday that adds up to real minutes. And because everything writes to the same order in real time, the kitchen display system reflects the addition immediately — the kitchen isn't guessing whether \"one more lassi\" was actually rung in."
    },
    {
      "t": "p",
      "text": "If an order needs to be cancelled outright — wrong table, duplicate entry, customer left — cancel with a reason keeps a record of why, rather than the order just disappearing. That record is what saves you from a confused conversation with a partner or auditor three weeks later about why Tuesday's sales don't match Tuesday's food cost."
    },
    {
      "t": "h2",
      "text": "GST invoicing without the mental math"
    },
    {
      "t": "p",
      "text": "Every bill that goes out to a dine-in or takeaway customer in India generally needs to be a proper tax invoice — GSTIN, tax breakup, sequential invoice number, the works. Doing that by hand on a calculator, per bill, is exactly the kind of task a POS should be doing invisibly in the background: it applies the right GST rate, generates the sequential invoice number, and hands you a digital receipt the customer can actually keep, without anyone at the counter opening a spreadsheet. If GST invoicing mechanics specifically are what you're trying to get right — rates, invoice numbering rules, what a compliant restaurant bill needs to contain — that's covered in more depth in [GST billing for restaurants](/blog/gst-billing-for-restaurants); this piece is about where that invoicing step sits inside the rest of the shift, not the compliance rules themselves."
    },
    {
      "t": "p",
      "text": "The practical win during a live shift is speed: the invoice is correct the first time, so there's no reprint, no manual tax correction, no customer standing at the counter while someone recalculates a CGST/SGST split by hand."
    },
    {
      "t": "h2",
      "text": "Payments: cash, UPI, and not making the customer wait"
    },
    {
      "t": "p",
      "text": "A café's payment mix on a normal day is rarely one method. Customer UPI at the table, pay at counter for takeaway, some cash, and — if the café is on a plan with Razorpay switched on — a card or online payment option too. The bill shouldn't change shape depending on how someone's paying; the total and the GST invoice are the same regardless, and reconciling which payment method covered which bill at the end of the day is what actually varies. A café running its ordering through [QR code ordering](/qr-code-ordering-system) at the table has this partly solved already, since the payment method gets captured at the point the order is placed rather than reconstructed later from memory."
    },
    {
      "t": "h2",
      "text": "Reports through the day, not just at the end"
    },
    {
      "t": "p",
      "text": "A manager shouldn't have to wait for closing time to know whether the day is on track. Core reports that update in real time — sales so far, what's selling, what's sitting — let someone glance at a phone at 3pm and notice that the lunch thali sold out an hour early, or that a particular table has been \"held\" for forty minutes with no update. That's the difference between operational software and a system that's just a faster calculator: recommendations and live numbers turn the POS into something you check during the shift, not just something you close out of at night."
    },
    {
      "t": "h2",
      "text": "Closing the shift: cash reconciliation and the day's actual numbers"
    },
    {
      "t": "p",
      "text": "At close, the cash drawer should be counted against what the system says it should hold — the opening float, plus every cash bill rung up during the shift, minus any cash refunds. If those two numbers don't match, you want to know it that night, with the specific bills to check, not three days later when it's impossible to reconstruct. This is the other half of cash shift and drawer reconciliation: the opening declaration at the start of the day is what makes the closing count mean something."
    },
    {
      "t": "p",
      "text": "For a small single-outlet café doing, say, 120 bills a day at an average ticket of ₹220, that's roughly ₹26,000 moving through the till daily across two or three payment methods. A ₹150 mismatch is easy to lose track of by hand and genuinely easy to spot when the system is doing the running total for you."
    },
    {
      "t": "h2",
      "text": "What this costs to run"
    },
    {
      "t": "p",
      "text": "None of the operational flow above needs a separate add-on — POS billing, KOT, the kitchen display system, GST invoicing, digital receipts, cash shift reconciliation, and core reports are part of the base experience on every KhaoPiyo plan, starting from the [Starter plan](/pricing) at ₹999/month for one café and up to three staff. There's no hardware to buy — it runs in a browser on whatever device the counter already has, a thermal printer is optional, and KhaoPiyo doesn't take a commission on sales; it's a flat subscription. A café can also sign up and start billing for free before choosing a paid plan, which is a reasonable way to see whether the daily flow actually fits before committing to anything."
    },
    {
      "t": "table",
      "head": [
        "Shift stage",
        "What it needs to do well",
        "Where it shows up"
      ],
      "rows": [
        [
          "Opening",
          "Log a starting cash float against a staff login",
          "Cash Shift & Drawer Reconciliation"
        ],
        [
          "Billing",
          "Handle adds, discounts, holds without rebilling",
          "POS Billing, Held Orders, Discounts"
        ],
        [
          "Kitchen",
          "Reflect order changes in real time",
          "Kitchen Display System"
        ],
        [
          "Invoicing",
          "Correct GST invoice on the first print",
          "GST Invoicing, Digital Receipts"
        ],
        [
          "Mid-shift",
          "Show what's selling without waiting for close",
          "Core Reports, Recommendations"
        ],
        [
          "Closing",
          "Reconcile counted cash against system total",
          "Cash Shift & Drawer Reconciliation"
        ]
      ]
    },
    {
      "t": "note",
      "text": "This walkthrough describes a single-outlet café's daily flow. A café running more than one outlet, or one that wants inventory, recipe costing and purchase tracking layered onto the same daily numbers, is a different scope — covered separately for [restaurant inventory management](/restaurant-inventory-management-software)."
    },
    {
      "t": "h2",
      "text": "If you're comparing this against what you use today"
    },
    {
      "t": "p",
      "text": "Most other restaurant POS software in India can bill, print a KOT and produce a GST invoice — that part is table stakes. The difference in daily use shows up in whether discounts and held orders need a workaround, whether the cash count at close is a manual tally or a comparison against a system total, and whether a manager can see the day's numbers without waiting for it to end. If you're evaluating options generally rather than looking at KhaoPiyo specifically, [how to choose restaurant POS software](/blog/how-to-choose-restaurant-pos-software) walks through the questions worth asking any vendor, and [restaurant POS software cost in India](/blog/restaurant-pos-software-cost-india) breaks down what these systems actually cost once you look past the headline price."
    }
  ],
  "faqs": [
    {
      "q": "Does a café POS handle GST invoicing automatically, or does staff still need to calculate tax?",
      "a": "A proper café POS applies the correct GST rate and generates a sequential tax invoice automatically when a bill is closed — staff don't calculate CGST/SGST splits by hand. The invoice includes the GSTIN, tax breakup and invoice number needed for a compliant restaurant bill, and a digital receipt is generated alongside it for the customer."
    },
    {
      "q": "How does cash shift reconciliation actually work day to day?",
      "a": "Whoever opens the counter logs a starting cash float against their staff login before taking orders. Through the shift, every cash bill adds to that running total automatically. At close, the drawer is counted physically and compared against the system's expected total (opening float plus cash sales minus cash refunds), so any mismatch is caught the same night with the specific bills to check, rather than discovered days later."
    },
    {
      "q": "Can a café run this without buying separate billing and inventory hardware?",
      "a": "With a browser-based POS like KhaoPiyo there's no hardware to buy — billing, KOT, kitchen display and GST invoicing all run on whatever device the counter already has, such as a phone, tablet or laptop. A thermal printer is optional for physical KOTs or receipts, not required to operate."
    }
  ],
  "related": [
    {
      "label": "How to choose restaurant POS software",
      "href": "/blog/how-to-choose-restaurant-pos-software"
    },
    {
      "label": "GST billing for restaurants",
      "href": "/blog/gst-billing-for-restaurants"
    },
    {
      "label": "KhaoPiyo pricing",
      "href": "/pricing"
    }
  ]
},

  {
  "slug": "qr-order-to-kitchen-how-it-works",
  "title": "From QR Scan to Kitchen: The Full Order Flow",
  "h1": "From QR Scan to Kitchen: How the Order Actually Travels",
  "description": "How a QR scan becomes a kitchen ticket and a settled bill — the exact steps, systems and screens behind modern café ordering.",
  "keywords": [
    "how does QR ordering work",
    "QR code ordering system for restaurants",
    "kitchen display system workflow",
    "KOT printing process",
    "restaurant order management system"
  ],
  "published": "2026-09-10",
  "readingMinutes": 8,
  "excerpt": "Scan, order, KOT, cook, bill, paid — five steps that look instant from the table but involve several systems talking to each other in the background. Here's exactly what happens in between.",
  "body": [
    {
      "t": "p",
      "text": "A guest scans a QR code, taps a few things, and twelve minutes later there's food on the table. From where they're sitting, that's the whole story. Behind it, though, that single scan sets off a small relay race between four or five separate parts of a system — a menu server, an order queue, a kitchen printer or display, a table management layer, and finally a billing engine — and if any one of those handoffs is clumsy, the guest notices, even if they can't say exactly why."
    },
    {
      "t": "p",
      "text": "This isn't the article that tells you whether to adopt QR ordering — we've already made that case in [does QR ordering actually work for restaurants](/blog/does-qr-ordering-work-for-restaurants). This one opens the hood. If you've ever wondered what really happens between a scan and a ticket landing in the kitchen, or why some systems feel instant while others lag by ten seconds, this is that explanation."
    },
    {
      "t": "h2",
      "text": "How the Menu Gets to the Guest's Phone"
    },
    {
      "t": "p",
      "text": "Every table (or every till, for counter service) carries a QR code that isn't a picture of a menu — it's a link to a live page. Scan it and the phone's browser opens a page fetched fresh from the café's server, not a PDF or an image someone uploaded three months ago. That matters more than it sounds: the moment a dish sells out or a price changes, the person doing the updating changes it once, in one place, and every table's code reflects it on the next scan. There's no reprinting, and no laminated menu with a price crossed out in pen."
    },
    {
      "t": "p",
      "text": "Under the hood, that code usually encodes two pieces of information — which café, and which table. Table 7's code and table 12's code point to the same [digital menu](/digital-menu-software) but tag the order differently once it's placed, which is what lets forty tables share one menu system without forty separate setups. The same structure works for counter-only cafés with no table numbers at all — the table tag is simply left out."
    },
    {
      "t": "h2",
      "text": "Placing the Order: What Actually Happens on Tap"
    },
    {
      "t": "p",
      "text": "The guest picks items, adjusts quantity, maybe adds a note (\"less spicy\", \"no onion\"), and hits place order. From that tap, three things need to happen almost at once: the order has to be written down permanently, the kitchen needs to know about it, and the table's status needs to update so staff walking past can see it's now occupied-with-an-order instead of still browsing."
    },
    {
      "t": "ul",
      "items": [
        "The order is saved with a timestamp, table number, item list and notes — this becomes the record the bill is built from later.",
        "A kitchen ticket is generated automatically, without a waiter re-typing anything by hand.",
        "The table itself flips state on the live floor view, so a manager glancing at a tablet can see which of fifteen tables have an active, unbilled order."
      ]
    },
    {
      "t": "p",
      "text": "This is also the point where QR ordering either saves a café real labour or doesn't. In a fully manual setup, a waiter still walks to the table, notes the order, walks to the kitchen, hands it over, and walks back — the QR code is decoration. In a properly wired system, the guest's tap does the writing-down and the handing-over in the same second, and the waiter's actual job shifts to running food and checking on tables instead of taking dictation."
    },
    {
      "t": "h2",
      "text": "The KOT: From Order to Kitchen Ticket"
    },
    {
      "t": "p",
      "text": "The kitchen order ticket, or KOT, is the internal document that tells the kitchen what to cook — separate from the bill, which the guest never sees until they ask for it. A KOT for one table might read: 1x Paneer Tikka, 2x Cold Coffee, 1x Veg Biryani (no onion), Table 9, 7:42 PM. No price on it anywhere. The kitchen doesn't need to know what a dish costs; it needs to know what to make and how fast."
    },
    {
      "t": "p",
      "text": "Where this gets interesting is timing. If a table orders in two rounds — starters first, mains fifteen minutes later — a well-built system treats that as two KOTs against one running order, not one edited ticket that gets confusing to read. That way the kitchen sees \"new items\" clearly instead of hunting through a ticket it's already halfway through cooking from."
    },
    {
      "t": "h2",
      "text": "Inside the Kitchen: Screen or Paper"
    },
    {
      "t": "p",
      "text": "From here the ticket goes one of two ways — a thermal printer produces a paper slip, or it lands on a kitchen display screen mounted above the pass. Both get the same information to the same place; the difference is what happens after it arrives."
    },
    {
      "t": "table",
      "head": [
        "",
        "Printed KOT",
        "Kitchen Display (KDS)"
      ],
      "rows": [
        [
          "New order arrives",
          "Printer prints a slip; cook pulls it off the spike",
          "Ticket appears on screen instantly, usually with a sound"
        ],
        [
          "Marking progress",
          "Cook crosses it out by hand, or leaves it as-is",
          "Cook taps to mark in-progress / ready — visible to the counter"
        ],
        [
          "Multiple stations (grill, tandoor, beverage)",
          "Needs a second printer per station, or one slip passed around",
          "Same ticket can route to each station's own screen"
        ],
        [
          "Paper and ink cost",
          "Ongoing — rolls, ribbons, a spike full of old slips",
          "None — nothing to print"
        ],
        [
          "Finding a lost ticket",
          "Gone once torn off, unless someone kept it",
          "Still in the system, searchable by table or time"
        ]
      ]
    },
    {
      "t": "p",
      "text": "Neither is objectively wrong — plenty of small, fast kitchens run perfectly well off a spike of paper tickets, and a thermal printer stays useful even alongside a display, as a backup and for handing a physical slip to a delivery rider. We've gone deeper on choosing between them in [kitchen display system vs KOT printer](/blog/kitchen-display-system-vs-kot-printer)."
    },
    {
      "t": "h2",
      "text": "Mid-Order Reality: Holds, Add-ons and Cancellations"
    },
    {
      "t": "p",
      "text": "Orders rarely stay clean once they hit the kitchen. A table wants to hold their order because they're waiting for one more person. A guest wants a plate of fries added after mains are already cooking. A dish gets cancelled because the kitchen ran out of an ingredient. A system built for a real café floor needs to handle all three without the KOT and the eventual bill drifting out of sync with each other."
    },
    {
      "t": "ul",
      "items": [
        "Held orders sit in a queue without going to the kitchen until someone releases them — useful for a table that's still deciding, or an order taken before everyone has arrived.",
        "Adding items later creates a second KOT for just the new items, so the kitchen isn't handed a full reprinted ticket it's already half-cooked.",
        "Cancelling an item after it's fired needs a reason attached — out of stock, guest changed their mind, kitchen error — because that reason is what shows up in reports later. It's the difference between \"we're losing money on wastage\" and \"we're losing money and nobody knows why.\""
      ]
    },
    {
      "t": "p",
      "text": "This is one of the places a notebook-and-memory setup quietly breaks down. Cancelling an item by hand isn't hard — it's that three weeks later, nobody remembers why twenty dishes across the month got voided."
    },
    {
      "t": "h2",
      "text": "Closing the Loop: Bill, Payment and Receipt"
    },
    {
      "t": "p",
      "text": "Once a table is done ordering, the running order becomes a bill — same underlying data, different document. This is where discounts get applied, GST is calculated by rate, and the format shifts from \"what to cook\" to \"what was consumed and what it costs.\" A compliant GST invoice needs the café's GSTIN, a proper CGST/SGST breakdown, and a sequential invoice number — not a hand-totalled slip written on the back of an order pad."
    },
    {
      "t": "p",
      "text": "Payment itself can go a few ways depending on how the café is set up — settled at the counter, a guest paying their own UPI directly, or a card machine brought to the table. Whichever path it takes, once the bill is marked paid, the table flips back to free on the floor view, and a digital receipt can reach the guest instead of a paper slip that ends up in the bin. The guest's own order history — what they had last visit, visible on their own phone — comes from this same billing record, not a separate system someone has to sync by hand."
    },
    {
      "t": "h2",
      "text": "What Happens When the Wi-Fi Drops"
    },
    {
      "t": "p",
      "text": "All of this depends on data moving between a phone, a server, a kitchen screen and a billing counter — which raises the obvious question: what happens on the Saturday evening the internet actually goes down? A cloud system genuinely needs a connection to accept a new order or send a fresh KOT; there's no getting around that, and it's worth knowing going in rather than discovering it mid-rush."
    },
    {
      "t": "note",
      "text": "If connectivity is a real concern at your location, ask directly during any trial: what does an order in progress look like the moment the connection drops, and how does it recover once it's back? The honest answer for most cloud POS systems is that a few seconds of interruption during recovery is normal — the goal is that nothing gets lost or double-charged, not that it never happens."
    },
    {
      "t": "h2",
      "text": "The Full Flow, Start to Finish"
    },
    {
      "t": "ol",
      "items": [
        "Guest scans the table's QR code and the live digital menu loads.",
        "Guest builds an order and taps place order.",
        "The order is saved with table, items, timestamp and notes.",
        "A KOT is generated and sent to a printer or a kitchen display.",
        "The table's status updates to \"ordered\" on the floor view.",
        "Kitchen marks items in progress, then ready; a waiter runs the food.",
        "Guest adds items, holds, or cancels as needed — each change leaves its own trail.",
        "Table requests the bill; the order becomes a GST invoice with tax and any discounts applied.",
        "Payment is taken — counter, UPI, or card — and the bill is marked paid.",
        "Table clears on the floor view and a digital receipt reaches the guest."
      ]
    },
    {
      "t": "p",
      "text": "None of these ten steps is complicated on its own. What's genuinely hard is making all ten happen without a human re-typing information that already exists somewhere in the system — that's really the whole pitch behind a connected ordering-to-billing setup instead of a QR code bolted onto an otherwise manual café. If you'd rather see the flow live than read about it, you can [sign up free](/get-started) and place a test order through the full pipeline in a few minutes."
    }
  ],
  "faqs": [
    {
      "q": "Does the kitchen need a computer to receive orders?",
      "a": "No. Most kitchens use either a thermal printer that automatically prints a KOT the moment an order is placed, or a tablet or screen running a kitchen display system. Neither requires kitchen staff to touch a keyboard — the ticket appears or prints on its own."
    },
    {
      "q": "What happens to a QR order if the internet goes down mid-service?",
      "a": "A cloud-based ordering system needs an internet connection to place a new order or send a fresh KOT to the kitchen, since the menu, the order and the kitchen ticket are all synced through the same server. If connectivity drops, new orders can't go through until it's back, though orders already fired to the kitchen and bills already generated aren't lost. It's worth testing this specifically, with a backup data connection for your location, before going fully live on it."
    },
    {
      "q": "Can a waiter still take the order manually instead of the guest scanning the QR code?",
      "a": "Yes — QR ordering isn't meant to replace a waiter, it's meant to remove the walk back and forth to the kitchen. A waiter can enter an order directly at the table (sometimes called tableside quick-add) and it goes through the exact same KOT and kitchen display flow as a guest's QR order. Cafés commonly run both side by side — regulars order themselves, first-time guests get walked through it by staff."
    }
  ],
  "related": [
    {
      "label": "Does QR Ordering Actually Work for Restaurants?",
      "href": "/blog/does-qr-ordering-work-for-restaurants"
    },
    {
      "label": "Kitchen Display System vs KOT Printer",
      "href": "/blog/kitchen-display-system-vs-kot-printer"
    },
    {
      "label": "Kitchen Display System",
      "href": "/kitchen-display-system"
    }
  ]
},

  {
  "slug": "customer-data-increase-repeat-orders",
  "title": "Using Customer Data to Bring Café Guests Back",
  "h1": "Using Customer Data to Bring Café Guests Back",
  "description": "How a café can use order history, loyalty and wallets to turn one-time guests into regulars — practical CRM tactics, not theory.",
  "keywords": [
    "café CRM software",
    "restaurant customer database",
    "loyalty program for cafes India",
    "repeat customers restaurant",
    "customer wallet cafe app"
  ],
  "published": "2026-09-10",
  "readingMinutes": 8,
  "excerpt": "Most cafés lose guests without ever knowing they left. Here's what customer data a small café can realistically collect, and the loyalty, coupon and wallet tactics that actually bring people back.",
  "body": [
    {
      "t": "p",
      "text": "Most cafés know exactly how many orders they did today and almost nothing about who placed them. A guest orders a cold coffee and a sandwich, pays, leaves — and the only trace is a line in the day's sales report. If they never come back, nobody notices, because there was never a record that they'd been a customer in the first place."
    },
    {
      "t": "p",
      "text": "That's the gap customer data closes. Not big-data dashboards or predictive algorithms — just knowing who your regulars are, what they usually order, how long it's been since their last visit, and having a way to reach them before they forget you exist. A small café doesn't need a marketing department for this. It needs a Customer Directory that fills itself in during normal billing, and two or three retention tactics run consistently. This is what a [restaurant POS software](/restaurant-pos-software) with CRM built in is actually for — not just billing faster, but remembering who walked in."
    },
    {
      "t": "h2",
      "text": "What \"customer data\" actually means for a café"
    },
    {
      "t": "p",
      "text": "Forget the enterprise CRM idea of customer data — purchase-intent scores, lifetime-value models, none of that applies to a 20-table café. What's actually useful is much smaller and entirely within reach of day-to-day billing:"
    },
    {
      "t": "ul",
      "items": [
        "Name and phone number — the minimum needed to recognise someone next visit",
        "Order history — what they usually order, how much they usually spend, how often",
        "Visit frequency — daily regular, weekly, or a one-time visitor who never returned",
        "Total spend to date — useful for spotting your highest-value guests, not just your most frequent ones",
        "Last visit date — the single most useful field for deciding who to re-engage"
      ]
    },
    {
      "t": "p",
      "text": "Every one of these can be captured automatically from billing, without a separate form, survey, or app download. If your POS already records a phone number at checkout for the GST invoice or digital receipt, you already have the raw material for a customer directory — you just need it collected in one place instead of scattered across paper bills."
    },
    {
      "t": "h2",
      "text": "Capturing the data without annoying anyone"
    },
    {
      "t": "p",
      "text": "The mistake most cafés make when they try to \"do CRM\" is adding friction — a feedback form, a loyalty card guests have to remember to carry, a QR code that opens a signup page nobody fills in. None of that survives contact with a lunch rush."
    },
    {
      "t": "p",
      "text": "The data collects itself better when it rides on something the guest is already doing. A guest scanning the table QR to place an order through [QR code ordering](/qr-code-ordering-system) naturally enters a phone number to track their order status — that's a directory entry with zero extra steps. A guest paying at the counter gives a phone number anyway if they want a digital receipt or a GST invoice. Neither interaction feels like \"signing up for marketing,\" but both quietly build the same directory. If you're still deciding whether QR ordering is worth setting up at all, [this breakdown of how QR ordering actually performs](/blog/does-qr-ordering-work-for-restaurants) is a reasonable place to start before you optimise for retention on top of it."
    },
    {
      "t": "note",
      "text": "Don't make phone number entry mandatory to place an order — some guests will always decline, and forcing it creates friction at exactly the moment you're trying to remove it. Let the directory build gradually from the guests who don't mind."
    },
    {
      "t": "h2",
      "text": "Turning a directory into segments you can act on"
    },
    {
      "t": "p",
      "text": "A list of 400 phone numbers isn't useful by itself. What makes it useful is splitting it into a handful of groups you can treat differently, because a guest who visits every Tuesday for lunch needs a different nudge than a guest who came in once eight months ago and never returned."
    },
    {
      "t": "table",
      "head": [
        "Segment",
        "How to spot it",
        "What to do"
      ],
      "rows": [
        [
          "Regulars",
          "5+ visits in 30 days",
          "Recognise them by name, don't discount — they're already coming"
        ],
        [
          "Lapsing",
          "Visited monthly, gone 3+ weeks",
          "A small win-back coupon or a WhatsApp nudge"
        ],
        [
          "One-time visitors",
          "Single order, never returned",
          "A modest first-return offer, since acquisition cost is already spent"
        ],
        [
          "High spenders",
          "Top 10% by total spend, any frequency",
          "Priority for loyalty perks — they're worth more per visit than frequent low-spend guests"
        ]
      ]
    },
    {
      "t": "p",
      "text": "A café doing 60 orders a day across a month will typically find a very unequal split — a small core of regulars generating a disproportionate share of revenue, and a long tail of guests who came in exactly once. The point of segmenting isn't to treat everyone equally well; it's to spend your retention effort — and any discount budget — on the segment where it changes behaviour, rather than handing the same 10% off to a regular who was coming back anyway."
    },
    {
      "t": "h2",
      "text": "Loyalty, coupons and Spin & Win: mechanics that actually bring people back"
    },
    {
      "t": "p",
      "text": "These three work differently and are worth understanding separately rather than lumping together as \"discounts.\""
    },
    {
      "t": "ul",
      "items": [
        "Loyalty & Rewards gives guests a reason tied to cumulative behaviour — points or a stamp-card style reward that only pays off after repeat visits, which is exactly the behaviour you're trying to build",
        "Coupons are targeted and time-bound — a specific offer sent to a specific segment, like 15% off for guests who haven't visited in three weeks, rather than a blanket discount that also gets used by guests who would have come anyway",
        "Spin & Win adds a small, low-cost element of chance at checkout or after an order — guests enjoy the interaction itself, and it works well as a light touch that doesn't require deep discounting to feel rewarding"
      ]
    },
    {
      "t": "p",
      "text": "None of these need to be generous to work. A ₹20 off next visit through Spin & Win, or 1 point per ₹100 spent through a loyalty program, costs a café very little against its average order value but gives a guest an actual reason to choose you over walking into a different café on their next craving. These features sit in the [pricing page's](/pricing) Growth plan alongside Customer Wallet and Table Reservations — worth checking against your own order volume before deciding if the upgrade from Starter pays for itself."
    },
    {
      "t": "h2",
      "text": "Customer wallet: prepaid balance that locks in the next visit"
    },
    {
      "t": "p",
      "text": "A customer wallet works differently from a coupon or loyalty point — it's money a guest has already committed to your café before they've decided what to order next. A guest topping up ₹500 into a wallet, especially with a small bonus attached, has functionally pre-booked a handful of future visits, because that balance only has value if they come back and spend it with you specifically."
    },
    {
      "t": "p",
      "text": "For a café with a steady base of office-goers or students nearby, a wallet converts irregular visits into a habit — the balance sitting there is a small, constant nudge to return rather than default to whatever's closest. It also smooths your own cash flow slightly, since the revenue is committed before the order is placed."
    },
    {
      "t": "h2",
      "text": "A simple weekly retention routine"
    },
    {
      "t": "p",
      "text": "None of this needs to be a full-time job. A café owner or manager can run the whole loop in under twenty minutes a week:"
    },
    {
      "t": "ol",
      "items": [
        "Pull last week's core reports and check total unique guests versus repeat guests",
        "Filter the customer directory for anyone who hasn't ordered in 18–21 days",
        "Send that segment a small win-back coupon rather than a generic broadcast to everyone",
        "Check which regulars crossed a spend threshold and are due a loyalty reward",
        "Glance at Spin & Win redemption — if nobody's spinning, the prompt isn't visible enough at checkout"
      ]
    },
    {
      "t": "p",
      "text": "The habit matters more than the sophistication. A café that does this loosely every week will out-retain one that builds an elaborate segmentation strategy once and never looks at it again."
    },
    {
      "t": "h2",
      "text": "What to avoid"
    },
    {
      "t": "p",
      "text": "A few ways retention efforts backfire, worth flagging before you start:"
    },
    {
      "t": "ul",
      "items": [
        "Discounting your regulars the same as first-timers — it trains loyal guests to expect a lower price and costs you margin on visits that were already happening",
        "Sending offers too often — a coupon that arrives weekly stops feeling like a reward and starts feeling like spam",
        "Collecting phone numbers but never acting on the data — a directory that just sits there is no better than the paper bill book it replaced",
        "Treating every guest identically regardless of spend or frequency — your top 10% of guests deserve different treatment than someone who ordered once and left"
      ]
    },
    {
      "t": "p",
      "text": "Customer data doesn't need to be complicated to be useful. A café that reliably knows who its regulars are, notices when they go quiet, and has one or two low-cost ways to bring them back will consistently out-retain a café relying on memory and good luck — regardless of whether the food is better. If you're setting this up for the first time, [getting started](/get-started) with a directory that builds itself from billing is a lower-effort starting point than building a loyalty program before you have the data to target it properly."
    }
  ],
  "faqs": [
    {
      "q": "Do I need a full loyalty program to keep customers coming back?",
      "a": "No — a Customer Directory with order history is the actual foundation, and that alone lets you spot regulars and lapsing guests. Loyalty points, coupons, Spin & Win and Customer Wallet are all ways to act on that data once you have it, but even without any of them, simply knowing who your repeat guests are and recognising them changes behaviour. Add the reward mechanics once you've confirmed the directory is filling in reliably."
    },
    {
      "q": "How does a café collect customer phone numbers without making people sign up for an app?",
      "a": "The two natural collection points are QR ordering, where a guest already enters a phone number to track their order, and counter billing, where a phone number is often given anyway for a digital receipt or GST invoice. Neither requires a separate signup step or app download — the directory builds itself from transactions that were happening regardless."
    },
    {
      "q": "Which plan includes loyalty, coupons and Spin & Win for a café?",
      "a": "On KhaoPiyo, the Customer Directory and CRM basics are included in every plan starting from Starter (₹999/month). Coupons, Loyalty & Rewards, Spin & Win and Customer Wallet are part of the Growth plan (₹2,499/month), which also adds Table Reservations and SMS/WhatsApp bill receipts. Full details are on the [pricing page](/pricing)."
    }
  ],
  "related": [
    {
      "label": "Does QR Ordering Actually Work for Restaurants?",
      "href": "/blog/does-qr-ordering-work-for-restaurants"
    },
    {
      "label": "KhaoPiyo Pricing & Plans",
      "href": "/pricing"
    },
    {
      "label": "QR Code Ordering System",
      "href": "/qr-code-ordering-system"
    }
  ]
},

  {
  "slug": "switching-restaurant-pos-software-checklist",
  "title": "Switching Restaurant POS Software Without Losing a Shift",
  "h1": "How to Switch Restaurant POS Software Without Losing a Shift",
  "description": "A practical checklist for moving to new POS software: data migration, staff training, picking a go-live day, and what to test before day one.",
  "keywords": [
    "switch restaurant pos software",
    "pos software migration checklist",
    "how to change pos system",
    "restaurant pos data migration",
    "go live new pos system",
    "cafe pos switch checklist"
  ],
  "published": "2026-09-10",
  "readingMinutes": 8,
  "excerpt": "You've already picked the new POS. Here's how to move your menu, train your staff and go live without losing a single order in the process.",
  "body": [
    {
      "t": "p",
      "text": "You've done the comparison, called a couple of vendors, maybe read our [guide on choosing restaurant POS software](/blog/how-to-choose-restaurant-pos-software), and picked one. This article isn't about that decision — it's about the two or three weeks between saying yes to a new POS and actually running your café on it, without a Friday dinner service turning into chaos because nobody can find the parcel button."
    },
    {
      "t": "p",
      "text": "Switching POS software is a small project, not an event. Cafés that get it wrong usually don't fail because the new software was bad — they fail because they tried to do it on a Saturday night with no data exported from the old system, no rehearsal, and staff who saw the new billing screen for the first time five minutes before the first order came in. None of that is hard to avoid if you treat it like a project with a checklist instead of a flip of a switch."
    },
    {
      "t": "h2",
      "text": "Pick a Low-Risk Go-Live Day"
    },
    {
      "t": "p",
      "text": "The single biggest mistake owners make is switching on the busiest day of the week because \"we might as well start fresh.\" Don't. Pick the quietest full business day you have — for most cafés that's a Monday or Tuesday lunch, not a weekend dinner service. You want a day with real orders coming through, so your staff are actually using the new system under normal pressure, but few enough covers that a five-minute hiccup at the counter doesn't turn into a queue out the door."
    },
    {
      "t": "p",
      "text": "Also avoid the first and last few days of the month if you can. That's when most owners are closing GST returns and reconciling the previous month's numbers on the old system — you don't want to be learning a new invoice sequence at the same time you're filing returns on the old one. Build in a buffer: pick your go-live date, then work backward a full week for training and testing, and don't move the date forward just because setup finished early. Rehearsal time is never wasted."
    },
    {
      "t": "h2",
      "text": "Get Your Data Out of the Old System"
    },
    {
      "t": "p",
      "text": "Before you touch the new system, export everything from the old one while you still have full access to it. Most POS vendors make this harder once you've told them you're leaving, and some charge for exports after cancellation, so do it on day one of the switch, not the last day of your notice period."
    },
    {
      "t": "h3",
      "text": "What actually needs to move"
    },
    {
      "t": "ul",
      "items": [
        "Menu items, categories, prices, and variants (size, add-ons) — this is the one thing you cannot skip, since re-typing a 90-item menu by hand on go-live morning is how launches get delayed.",
        "Customer directory / CRM contacts, if your old system had one — names and phone numbers so repeat customers aren't starting from zero.",
        "Staff list and roles, so you're not creating logins from memory under time pressure.",
        "Sales history as a PDF or CSV export, for your own records and for GST reconciliation — most systems won't let you import old sales into a new platform, and you don't need them to. You just need them saved somewhere outside the old system before your account there gets deactivated."
      ]
    },
    {
      "t": "p",
      "text": "Sales history is the part owners worry about most and need to worry about least. You are not trying to make ten months of historical bills appear inside the new POS — you're trying to make sure your accountant still has access to last year's numbers after you've stopped paying for the old subscription. A dated folder of exported CSVs and GST invoice PDFs covers that completely."
    },
    {
      "t": "h2",
      "text": "Parallel Run or Hard Cutover"
    },
    {
      "t": "p",
      "text": "There are two ways to actually make the switch, and which one fits depends on your café's size and how forgiving your customers are of a slower counter for a day."
    },
    {
      "t": "table",
      "head": [
        "Approach",
        "How it works",
        "Best for"
      ],
      "rows": [
        [
          "Hard cutover",
          "Old system stops, new system starts, on one agreed morning. No orders run through both.",
          "Single-café operations with one billing counter and a full week of staff training already done."
        ],
        [
          "Parallel run",
          "Both systems stay live for 2-3 days; new bills go through the new POS, old system stays open only to close out anything already in progress.",
          "Multi-counter or multi-café setups, or teams still shaky on the new screens after training."
        ]
      ]
    },
    {
      "t": "p",
      "text": "A parallel run feels safer, but it has a real cost: your staff are mentally juggling two systems, which is exactly the kind of split attention that causes double-billing or a KOT sent to the kitchen from the wrong screen. Most single-location cafés are better off with a clean hard cutover on a quiet day than a blurry few days running both. If you do run parallel, set a hard end date in advance — \"we'll decide when it feels ready\" tends to stretch into weeks."
    },
    {
      "t": "h2",
      "text": "Train Staff Before the Switch, Not During It"
    },
    {
      "t": "p",
      "text": "Picture a waiter who's used the old system's tableside billing for two years, being handed a new screen at 8pm on a Friday with four tables waiting. That's not a training failure on his part — it's a scheduling failure on yours. Training has to happen before go-live, on the actual new system, ideally with fake orders during a closed hour or a slow afternoon."
    },
    {
      "t": "p",
      "text": "Break it into roles instead of one general session, since a waiter, a cashier and a kitchen staffer use completely different screens: waiter tableside quick-add, counter billing and KOT/discounts/held orders, and the kitchen display. Run each person through their own real workflow — take an order, send it to the kitchen, hold an order and come back to it, cancel one with a reason, close a shift and reconcile the drawer — at least twice before the day you go live. If your new system has per-role screen access, set that up during training too, so staff only ever see the buttons relevant to their job on day one, not a full admin screen that can distract or confuse them."
    },
    {
      "t": "h2",
      "text": "The Pre-Launch Checklist: What to Test Before Day One"
    },
    {
      "t": "p",
      "text": "Run through this on the new system, in your actual café, with your actual printer and internet connection, at least one full day before go-live — not the night before."
    },
    {
      "t": "ol",
      "items": [
        "Bill a real test order end to end, including a GST invoice, and check the tax breakdown and invoice number look right.",
        "Send a KOT to the kitchen display and confirm it shows up correctly and in order.",
        "Hold an order, serve two other tables, then come back and complete the held one.",
        "Cancel an order with a reason and confirm it's logged, not just deleted.",
        "Close a cash shift and reconcile the drawer against what the system says you took in.",
        "If you use QR ordering, scan the actual table QR codes and place a test order from a phone, not just from the admin screen.",
        "Print a physical receipt if you use a thermal printer, and confirm your printer talks to the new system without a driver issue you're discovering for the first time.",
        "Log in as each staff role you've set up and confirm they see only what they're supposed to see."
      ]
    },
    {
      "t": "note",
      "text": "If any single item on this list fails, don't go live on schedule. A missed step here is a five-minute fix during testing and a forty-five-minute scramble in front of customers on launch day."
    },
    {
      "t": "h2",
      "text": "Go-Live Day: Keep It Boring"
    },
    {
      "t": "p",
      "text": "The best go-live days are uneventful. Open a little earlier than usual so the counter is already running on the new system before the first customer walks in, keep the old system's login handy but untouched, and have whoever set up the new POS actually present at the café for the first service, not reachable by phone. Most of the issues that come up on day one are small — someone forgets which button holds an order, a printer needs re-pairing — and they get solved in seconds if a person who knows the system is standing at the counter, not in minutes if everyone's texting a vendor's support line mid-rush."
    },
    {
      "t": "p",
      "text": "This is also where the earlier decisions pay off. Because a cloud POS like [KhaoPiyo](/) runs in a browser on whatever device you already have, there's no hardware swap to coordinate on launch morning — your billing counter, kitchen display and waiter's phone just point at a new tab, and a thermal printer that already worked with your old system will generally keep working with the new one."
    },
    {
      "t": "h2",
      "text": "The First Week After Switching"
    },
    {
      "t": "p",
      "text": "Keep the old system's login active and read-only for at least a billing cycle, even after go-live — you'll want to check a past bill or a customer's order history more often than you'd expect in the first couple of weeks. Reconcile your cash drawer manually against the new system's numbers every day for the first week rather than trusting it blind; small setup mistakes (a wrong tax rate on one item, a duplicate menu entry) show up fastest in a mismatched drawer count, not in a report nobody reads until month-end."
    },
    {
      "t": "p",
      "text": "Don't cancel the old subscription the day you go live. Wait until you've closed and reconciled at least one full GST filing cycle on the new system and you're confident your [GST invoicing](/blog/gst-billing-for-restaurants) is generating correctly — invoice numbering issues are the one migration mistake that's genuinely painful to fix after the fact, since you can't retroactively renumber invoices you've already given customers."
    },
    {
      "t": "p",
      "text": "None of this needs to take longer than two to three weeks from decision to stable operation, and most of that time is training and testing, not the actual switch. If you haven't picked a system yet, sign-up on most cloud POS platforms — [KhaoPiyo included](/get-started) — is free, so you can set up your menu and test the workflow above before you commit to a paid plan, which makes the whole migration checklist something you can run through before go-live rather than after."
    }
  ],
  "faqs": [
    {
      "q": "How long does switching restaurant POS software actually take?",
      "a": "For a single café, plan on two to three weeks from the day you commit to a new system to a stable go-live: a few days to export data and set up your menu, a few days for staff training and testing, and one quiet day to actually cut over. Rushing this into a weekend usually costs you more time in mid-service troubleshooting than it saves."
    },
    {
      "q": "Will I lose my sales history when I switch POS software?",
      "a": "You won't be able to import your old sales history into the new system — most POS platforms don't support that, and you don't actually need them to. Export your sales reports and GST invoices from the old system as PDF or CSV before you cancel it, and keep them filed separately for your accountant. The new system starts a fresh sales record from your go-live date, which is normal and expected."
    },
    {
      "q": "Should I switch POS systems during my slow season?",
      "a": "A quieter period makes training easier since staff have more time between orders to get comfortable, but you don't need to wait for an entire slow season — a single quiet weekday is usually enough for the cutover itself. What matters more than the season is avoiding month-end (when you're closing GST returns on the old system) and avoiding your single busiest day of the week for the actual go-live."
    }
  ],
  "related": [
    {
      "label": "How to Choose Restaurant POS Software",
      "href": "/blog/how-to-choose-restaurant-pos-software"
    },
    {
      "label": "Restaurant POS Software Cost in India",
      "href": "/blog/restaurant-pos-software-cost-india"
    },
    {
      "label": "KhaoPiyo Pricing",
      "href": "/pricing"
    }
  ]
}]

export function getArticle(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug)
}

/** Newest first — the order the index page and the sitemap both use. */
export function articlesByDate(): Article[] {
  return [...ARTICLES].sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0))
}
