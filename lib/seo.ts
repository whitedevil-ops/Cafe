// Structured-data helpers shared by the marketing pages.
//
// Written as builders rather than copied per page for one reason that matters
// beyond tidiness: schema has to keep matching what a visitor can actually
// read. When the FAQ list on the page and the FAQPage JSON-LD are the same
// array, they cannot drift apart — and a page whose schema promises answers
// the page does not show is exactly what Google penalises.

export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export type Faq = { q: string; a: string }

export function faqJsonLd(faqs: Faq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
}

/**
 * Breadcrumbs for a page that is not the home page. Google uses these to
 * replace the raw URL in results with a readable trail, which matters most on
 * the nested location pages where the URL is otherwise a mouthful.
 */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...trail].map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path === '/' ? '' : item.path}`,
    })),
  }
}

/** Convenience for pages that want both graphs in a single script tag. */
export function jsonLdGraph(...nodes: object[]) {
  return JSON.stringify(nodes.length === 1 ? nodes[0] : nodes)
}

/**
 * Article schema for blog posts. The author is the company rather than an
 * invented byline — attributing a post to a person who does not exist is the
 * kind of small fabrication that costs trust for nothing in return.
 */
export function articleJsonLd(a: {
  title: string
  description: string
  path: string
  published: string
  updated?: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}${a.path}` },
    datePublished: a.published,
    dateModified: a.updated ?? a.published,
    author: { '@type': 'Organization', name: 'KhaoPiyo', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'KhaoPiyo',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.png` },
    },
  }
}

// Plan prices deliberately live in components/marketing/pricing-cards.tsx and
// nowhere else. /pricing renders that same component rather than restating the
// numbers, so the page, the homepage and the SoftwareApplication offers in the
// root layout cannot quote three different prices.
