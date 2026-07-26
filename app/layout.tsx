import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
    "Cloud POS SaaS for cafés and restaurants — billing, QR ordering, GST invoicing, inventory, CRM and loyalty in one platform. Built in Hisar, India — a modern alternative to Petpooja and legacy POS billing systems.",
  keywords: [
    "POS SaaS", "restaurant POS SaaS", "POS billing software", "billing SaaS India",
    "restaurant billing software", "cafe billing software", "cafe POS software",
    "food bill software", "GST billing software India", "QR ordering system",
    "cloud POS for restaurants", "cloud billing software", "restaurant POS Hisar",
    "cafe software Hisar", "Petpooja alternative", "KhaoPiyo",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    siteName: "KhaoPiyo",
    title: "KhaoPiyo — POS & Billing Software for Cafés and Restaurants",
    description:
      "Cloud POS SaaS for cafés and restaurants — billing, QR ordering, GST invoicing, inventory, CRM and loyalty in one platform. Built for Indian cafés and restaurants.",
    type: "website",
    locale: "en_IN",
    url: siteUrl,
  },
  twitter: { card: "summary_large_image" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "KhaoPiyo",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Restaurant POS SaaS & Billing Software",
      operatingSystem: "Web",
      url: siteUrl,
      description:
        "Cloud POS SaaS and billing software for cafés and restaurants — QR ordering, GST invoicing, inventory, CRM and loyalty in one platform.",
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "INR",
        lowPrice: "999",
        highPrice: "4999",
        offerCount: "3",
      },
    },
    {
      "@type": "Organization",
      name: "KhaoPiyo",
      url: siteUrl,
      logo: `${siteUrl}/logo-mark.png`,
      description: "Café and restaurant POS billing software, built in Hisar, India.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
