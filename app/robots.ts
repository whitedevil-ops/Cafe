import type { MetadataRoute } from 'next'

// Falls back to the real production domain, not localhost — see sitemap.ts.
const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

// Marketing pages are indexable; the app (dashboard, POS, kitchen, QR) is not (§42).
//
// /t and /r are trailing-slash prefixes, not bare paths — Disallow: /r would
// otherwise prefix-match ANY path starting with those two characters, which
// silently blocked /reset-password (an existing page) and, when it was
// added, /restaurant-inventory-management-software from being crawled at
// all. Caught via Search Console reporting "blocked by robots.txt" for the
// latter. /t/[token] and /r/[token] always have a token after the slash, so
// the trailing-slash form still blocks every real customer/receipt route.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/onboarding', '/kds', '/t/', '/r/', '/api'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
