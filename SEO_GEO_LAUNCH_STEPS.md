# KhaoPiyo — Search Console, Bing, and Directory Listings

Manual steps to run after the SEO/GEO code changes (this commit). Everything
below uses only real, shipped facts — no invented metrics, clients, or
features.

## 1. Google Search Console

1. Go to https://search.google.com/search-console and sign in.
2. **Add property** → choose **URL prefix** → enter `https://khaopiyo.ventron.in`.
3. Verify ownership with the **HTML tag** method (no file upload needed):
   - Google gives you a tag like `<meta name="google-site-verification" content="XXXXXXXX" />`.
   - Copy just the `content` value.
   - In Vercel → this project → Settings → Environment Variables, add:
     - `NEXT_PUBLIC_GSC_VERIFICATION` = `XXXXXXXX`
   - Redeploy. The tag is now emitted automatically (this was just wired up in `app/layout.tsx` — no further code change needed).
   - Back in Search Console, click **Verify**.
4. Once verified, go to **Sitemaps** (left nav) → enter `sitemap.xml` → **Submit**.
5. Check **Settings → Ownership verification** stays valid, and after a few days check **Pages** for indexing status and **Performance** for query data.

## 2. Bing Webmaster Tools

Bing also powers Copilot's answers, so this feeds both search and GEO.

1. Go to https://www.bing.com/webmasters and sign in.
2. **Add a site** → enter `https://khaopiyo.ventron.in`.
3. If offered an **"Import from Google Search Console"** option, use it — it copies verification and sitemap automatically. Otherwise verify manually:
   - Choose the **meta tag** method: Bing gives `<meta name="msvalidate.01" content="XXXXXXXX" />`.
   - In Vercel, add `NEXT_PUBLIC_BING_VERIFICATION` = `XXXXXXXX` and redeploy (same mechanism as Google, already wired up).
4. Go to **Sitemaps** → submit `https://khaopiyo.ventron.in/sitemap.xml`.
5. Optional: under **URL Inspection**, request indexing for the homepage and the two newest pages (`/digital-menu-software`, `/cloud-kitchen-pos-software`) to speed up first crawl.

---

## 3. Product directory listings

Common fields and ready-to-paste copy for G2, Capterra, GetApp, SoftwareSuggest, and Product Hunt.

### Core facts (same everywhere)

| Field | Value |
|---|---|
| Product name | KhaoPiyo |
| Website | https://khaopiyo.ventron.in |
| Company | Ventron |
| Headquarters | Hisar, Haryana, India |
| Founder | Vineet Sharma |
| Category | Restaurant POS Software / Restaurant Management Software |
| Pricing | ₹999, ₹2,499, ₹4,999 per month (flat, no hardware required) |
| Free trial | Yes |

### Short description (~200 characters — G2, Capterra, GetApp)

> KhaoPiyo is a cloud POS and operations platform for cafés and restaurants — billing, QR ordering, digital menus, kitchen display, GST invoicing, CRM and loyalty in one connected system.

### Long description (~700 characters — G2, Capterra, GetApp "About" field)

> KhaoPiyo is a cloud-based point-of-sale and operations platform built for cafés, cloud kitchens and casual-dining restaurants in India. It replaces a bill book, a spreadsheet and a separate ordering app with one connected system: fast counter billing with variants and split payments, QR code ordering guests use from their own phone with no app to install, a digital menu that stays in sync everywhere, a live kitchen display (KOT/KDS), GST-compliant invoicing with automatic CGST/SGST and HSN/SAC codes, recipe-linked inventory and food costing, customer CRM, a points-based loyalty program, and owner-facing analytics. Plans start at ₹999/month, no hardware to buy. Built by Ventron, a technology company based in Hisar, Haryana, India.

### Feature list (checkbox / tag fields most directories ask for)

- Point of sale / billing
- QR code ordering
- Digital menu management
- Kitchen display system (KDS/KOT)
- GST invoicing (CGST/SGST, HSN/SAC)
- Inventory & recipe costing
- Customer CRM
- Loyalty & rewards
- Coupons & discounts
- Table reservations
- Expense tracking
- Sales & analytics reporting
- Role-based staff access
- Split payments (cash/card/UPI/wallet)

### Product Hunt tagline (≤60 characters)

> One system for café billing, QR ordering & kitchen ops

### Product Hunt "first comment" (maker's intro)

> Hey — I'm Vineet, founder of Ventron. We built KhaoPiyo because most café owners we talked to in India were juggling a bill book, a spreadsheet for GST, and a separate app just for QR ordering. KhaoPiyo puts billing, QR ordering, a live kitchen display, GST invoicing, and loyalty in one place, starting at ₹999/month with no hardware to buy. It's running live today at a real café in Hisar, Haryana. Happy to answer anything about how it works.

---

### Per-directory notes

**G2** (https://www.g2.com/products/new)
- Category: "Restaurant Management" or "Point of Sale (POS)"
- G2 profiles typically need a handful of genuine user reviews before the listing goes fully live/visible in search — worth asking Brewora Café's staff/owner for one once they've used it a while, but don't submit a review yourself as the vendor.

**Capterra + GetApp** (same submission, same parent company — Gartner Digital Markets)
- Submit once at https://www.capterra.com/vendors — it typically syndicates to GetApp automatically under the same vendor account, so there's no need to submit twice.
- Category: "Restaurant POS Systems"

**SoftwareSuggest** (https://www.softwaresuggest.com/listing) — India-focused, good keyword/audience fit
- Category: "Restaurant POS Software"
- This directory tends to ask for a support/contact email and a few screenshots — use real product screenshots, not stock images.

**Product Hunt** (https://www.producthunt.com/posts/new)
- Post as the maker (Vineet), use the tagline + first-comment copy above.
- Topics: SaaS, Restaurant Tech / Point of Sale, India
- Product Hunt rewards a coordinated launch day (maker replies actively in comments) more than the listing itself — worth picking a specific day rather than posting and leaving it.

### A note on screenshots

Every directory above asks for product screenshots. Use real screenshots of
the live dashboard/POS/QR menu (e.g. from `khaopiyo.ventron.in` or the
Brewora Café pilot) — none are included here since generating or faking them
would violate the "no invented facts" rule this whole pass followed.
