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
// Marketing pages are meant to be crawled and cited — by search engines and
// by AI answer engines alike (Google AI Overview, ChatGPT, Perplexity,
// Copilot). The wildcard rule below already allows every crawler that isn't
// named explicitly, but each major AI crawler is listed anyway so eligibility
// is unambiguous rather than implicit.
const disallow = ['/dashboard', '/onboarding', '/kds', '/t/', '/r/', '/api']

const aiAndSearchBots = [
  'Googlebot', 'Bingbot',
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', // OpenAI
  'ClaudeBot', 'Claude-Web', 'anthropic-ai', // Anthropic
  'PerplexityBot', // Perplexity
  'Google-Extended', // Google's AI-training crawler (separate from Googlebot)
  'Applebot-Extended', // Apple Intelligence
  'CCBot', // Common Crawl — a training source for many LLMs
  'Amazonbot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      ...aiAndSearchBots.map((userAgent) => ({ userAgent, allow: '/', disallow })),
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
