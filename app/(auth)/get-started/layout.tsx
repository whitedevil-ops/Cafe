import type { Metadata } from 'next'

// The page itself is a client component, so its metadata has to live here.
// It matters: /get-started is the destination of every public CTA and the only
// signup URL in the sitemap, and without this it inherited the generic
// homepage title.
export const metadata: Metadata = {
  title: 'Start with KhaoPiyo — Restaurant POS Software',
  description:
    'Tell us about your café and get set up on KhaoPiyo — POS billing, GST invoices, QR ordering, kitchen display and inventory. No setup fee, no commission on sales.',
  keywords: [
    'KhaoPiyo signup', 'start restaurant POS', 'try restaurant POS software India',
    'cafe POS free trial', 'restaurant billing software demo',
  ],
  alternates: { canonical: '/get-started' },
  openGraph: {
    title: 'Start with KhaoPiyo — Restaurant POS Software',
    description:
      'Tell us about your café and get set up on KhaoPiyo. No setup fee, no commission on sales.',
    type: 'website',
  },
}

export default function GetStartedLayout({ children }: { children: React.ReactNode }) {
  return children
}
