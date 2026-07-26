import type { MetadataRoute } from 'next'

// Falls back to the real production domain, not localhost — if
// NEXT_PUBLIC_APP_URL is ever unset in Vercel (as it was found to be),
// this is what actually gets crawled instead of an unreachable URL.
const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pos-billing-software`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/petpooja-alternative`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/cookies`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
