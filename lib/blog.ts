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
]

export function getArticle(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug)
}

/** Newest first — the order the index page and the sitemap both use. */
export function articlesByDate(): Article[] {
  return [...ARTICLES].sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0))
}
