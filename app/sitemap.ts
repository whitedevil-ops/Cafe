import type { MetadataRoute } from 'next'
import { ARTICLES } from '@/lib/blog'

// Falls back to the real production domain, not localhost — if
// NEXT_PUBLIC_APP_URL is ever unset in Vercel (as it was found to be),
// this is what actually gets crawled instead of an unreachable URL.
const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

// Kept in step with app/restaurant-pos-software/[city]/page.tsx by hand. A page
// file can only export Next's own symbols, so the list can't be imported from
// there; if a city is added, add it here too.
const CITY_SLUGS = ['hisar', 'gurugram', 'noida', 'pune', 'bangalore-hsr-layout']

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const marketing: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/restaurant-pos-software`, lastModified: now, changeFrequency: 'weekly', priority: 0.95 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.95 },
    { url: `${base}/pos-billing-software`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/petpooja-alternative`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/qr-code-ordering-system`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${base}/kitchen-display-system`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${base}/restaurant-inventory-management-software`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${base}/gst-billing-software-for-restaurants`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${base}/digital-menu-software`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${base}/cloud-kitchen-pos-software`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${base}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    // The lead-capture page is the entry point every public CTA points at.
    // /signup still exists for onboarding but is deliberately unlinked, so it
    // stays out of the sitemap rather than competing with this one.
    { url: `${base}/get-started`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ]

  const cities: MetadataRoute.Sitemap = CITY_SLUGS.map((slug) => ({
    url: `${base}/restaurant-pos-software/${slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  const blog: MetadataRoute.Sitemap = [
    { url: `${base}/blog`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    ...ARTICLES.map((a) => ({
      url: `${base}/blog/${a.slug}`,
      // The article's own date, not "now" — a lastmod that moves on every
      // deploy teaches crawlers to ignore the field entirely.
      lastModified: new Date(`${a.updated ?? a.published}T00:00:00Z`),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]

  const legal: MetadataRoute.Sitemap = [
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/cookies`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  return [...marketing, ...cities, ...blog, ...legal]
}
