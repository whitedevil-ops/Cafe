import type { MetadataRoute } from 'next'

const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

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
