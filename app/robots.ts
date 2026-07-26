import type { MetadataRoute } from 'next'

// Falls back to the real production domain, not localhost — see sitemap.ts.
const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

// Marketing pages are indexable; the app (dashboard, POS, kitchen, QR) is not (§42).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/onboarding', '/kds', '/t', '/r', '/api'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
