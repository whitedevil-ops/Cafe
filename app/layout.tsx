import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { DesktopSessionBridge } from "@/components/desktop-session-bridge";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Marketing-only display face (applied via the `font-display` utility class
// in globals.css) — Geist Sans stays the only font everywhere else
// (dashboard, ops) so this never touches the product UI.
const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

// Falls back to the real production domain, not localhost — Vercel was
// found to be missing NEXT_PUBLIC_APP_URL, which had canonical/OG tags and
// the sitemap pointing at localhost:3000 in production (Search Console
// flagged all 8 sitemap URLs as errors because of it).
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://khaopiyo.ventron.in";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "KhaoPiyo — POS & Billing Software for Cafés and Restaurants",
    template: "%s · KhaoPiyo",
  },
  description:
    "Cloud POS billing software for cafés and restaurants — QR ordering, GST invoicing, inventory, CRM and loyalty. A modern Petpooja alternative built in India.",
  keywords: [
    "POS SaaS", "restaurant POS SaaS", "POS billing software", "billing SaaS India",
    "restaurant billing software", "cafe billing software", "cafe POS software",
    "food bill software", "GST billing software India", "QR ordering system",
    "QR code ordering system", "restaurant inventory management software",
    "GST billing software for restaurants", "cloud POS for restaurants",
    "cloud billing software", "restaurant POS Hisar",
    "cafe software Hisar", "Petpooja alternative", "KhaoPiyo",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    siteName: "KhaoPiyo",
    title: "KhaoPiyo — POS & Billing Software for Cafés and Restaurants",
    description:
      "Cloud POS SaaS for cafés and restaurants — billing, QR ordering, GST invoicing, inventory, CRM and loyalty. Built for Indian cafés and restaurants.",
    type: "website",
    locale: "en_IN",
    url: siteUrl,
  },
  twitter: { card: "summary_large_image" },
  // Set NEXT_PUBLIC_GSC_VERIFICATION / NEXT_PUBLIC_BING_VERIFICATION at
  // deploy time to add the Google Search Console / Bing Webmaster Tools
  // ownership meta tag without a code change — same pattern as ventron.in's
  // own layout.tsx. Omitted entirely (no tag) when unset.
  verification: {
    ...(process.env.NEXT_PUBLIC_GSC_VERIFICATION
      ? { google: process.env.NEXT_PUBLIC_GSC_VERIFICATION }
      : {}),
    ...(process.env.NEXT_PUBLIC_BING_VERIFICATION
      ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_VERIFICATION } }
      : {}),
  },
};

// Deliberately Organization and not LocalBusiness. KhaoPiyo is software sold
// across India, not a place a customer visits; LocalBusiness would claim a
// storefront that does not exist. There is likewise no aggregateRating here —
// inventing one is the single most common piece of structured-data fraud, and
// there are no published reviews to aggregate.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      // This node is what Google reads for the SITE NAME — the label shown
      // above the URL in a search result. It currently renders "ventron.in",
      // because Google resolves site names against the registrable domain and
      // only grants a subdomain its own name once it is convinced the
      // subdomain is a separate site. og:site_name, <title> and this `name`
      // all already say KhaoPiyo; `url` is the documented homepage form
      // (trailing slash, matching Google's own example) so the node
      // unambiguously describes the subdomain root rather than a path under
      // it, and alternateName offers the spaced spelling people also search.
      // Google chooses in the end — none of this forces the label.
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: "KhaoPiyo",
      alternateName: "Khao Piyo",
      url: `${siteUrl}/`,
      inLanguage: "en-IN",
      // Names what this site is ABOUT, rather than leaving Google to infer it.
      // Without the link the graph says "a website called KhaoPiyo" and,
      // separately, "some software called KhaoPiyo"; with it, the site and the
      // product are one identified thing. Reference by @id — repeating the
      // node inline would create the duplicate entity this graph exists to
      // avoid.
      about: { "@id": `${siteUrl}/#software` },
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#software`,
      name: "KhaoPiyo",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Restaurant POS SaaS & Billing Software",
      operatingSystem: "Web, Windows, macOS",
      url: siteUrl,
      description:
        "Cloud POS SaaS and billing software for cafés and restaurants — QR ordering, GST invoicing, inventory, CRM and loyalty in one platform.",
      publisher: { "@id": `${siteUrl}/#organization` },
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "INR",
        lowPrice: "999",
        highPrice: "4999",
        offerCount: "3",
        url: `${siteUrl}/pricing`,
      },
    },
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "KhaoPiyo",
      url: siteUrl,
      logo: `${siteUrl}/logo-mark.png`,
      description: "Café and restaurant POS billing software, built in Hisar, India.",
      // Locality only. There is no published street address for the business,
      // and inventing one to fill the schema would be a fabricated record.
      address: {
        "@type": "PostalAddress",
        addressLocality: "Hisar",
        addressRegion: "Haryana",
        addressCountry: "IN",
      },
      areaServed: { "@type": "Country", name: "India" },
      // KhaoPiyo is a Ventron product (see Ventron's own site.ts COMPANY_FAQS,
      // which names KhaoPiyo among its products) — no Ventron logo asset
      // lives in this repo, so only verifiable name/url are referenced here.
      parentOrganization: {
        "@type": "Organization",
        name: "Ventron",
        url: "https://ventron.in",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolageGrotesque.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Root rather than the dashboard layout: a signed-out desktop launch
            lands on /login, and that is exactly where the stored session has
            to be restored from. */}
        <DesktopSessionBridge />
        {/* Cloudflare Web Analytics — afterInteractive per Next's own guidance
            (analytics is a listed good candidate), so it never delays hydration. */}
        <Script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          strategy="afterInteractive"
          data-cf-beacon='{"token": "f2fcb9d748eb4d5282887d5f2ee57b0b"}'
        />
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
