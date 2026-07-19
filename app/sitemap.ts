import type { MetadataRoute } from 'next'

const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${base}/`, lastModified: now, priority: 1 },
    { url: `${base}/signup`, lastModified: now, priority: 0.8 },
    { url: `${base}/login`, lastModified: now, priority: 0.5 },
    { url: `${base}/legal/privacy`, lastModified: now, priority: 0.2 },
    { url: `${base}/legal/terms`, lastModified: now, priority: 0.2 },
    { url: `${base}/legal/cookies`, lastModified: now, priority: 0.2 },
  ]
}
