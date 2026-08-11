import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { articlesByDate } from '@/lib/blog'
import { SITE_URL, breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'

export const metadata: Metadata = {
  // No brand suffix here — the root layout's title template already appends
  // "· KhaoPiyo", and "Blog — KhaoPiyo · KhaoPiyo" is what happens otherwise.
  title: 'Restaurant Operations Blog for Café Owners',
  description:
    'Practical writing for Indian café and restaurant owners: choosing POS software, GST billing, food cost control, QR ordering and kitchen workflow.',
  keywords: [
    'restaurant blog India', 'cafe management tips', 'restaurant POS guide',
    'restaurant operations India', 'food cost control blog',
  ],
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'Restaurant Operations Blog · KhaoPiyo',
    description:
      'Guides on POS software, GST billing, food costing, QR ordering and kitchen workflow for Indian cafés.',
    url: `${SITE_URL}/blog`,
    type: 'website',
  },
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function BlogIndexPage() {
  const articles = articlesByDate()

  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(breadcrumbJsonLd([{ name: 'Blog', path: '/blog' }])),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-10">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">Blog</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-semibold tracking-tight text-foreground">
          Notes from running a café, not marketing a product.
        </h1>
        <p className="mt-6 text-[16.5px] leading-relaxed text-muted-foreground">
          Guides on the parts of running a café that software touches — buying a POS, GST invoices,
          food cost, QR ordering, the kitchen pass. Written to be useful whether or not you ever use
          KhaoPiyo.
        </p>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <div className="divide-y divide-border border-t border-border">
          {articles.map((a) => (
            <article key={a.slug} className="py-8">
              <div className="flex items-center gap-3 text-[12.5px] text-muted-foreground">
                <time dateTime={a.published}>{formatDate(a.published)}</time>
                <span aria-hidden>·</span>
                <span>{a.readingMinutes} min read</span>
              </div>
              <h2 className="mt-2 text-[clamp(1.15rem,2.5vw,1.4rem)] font-semibold tracking-tight text-foreground">
                <Link href={`/blog/${a.slug}`} className="hover:text-primary">
                  {a.h1}
                </Link>
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{a.excerpt}</p>
              <Link
                href={`/blog/${a.slug}`}
                className="mt-3 inline-block text-[14px] font-medium text-primary hover:underline"
              >
                Read it
              </Link>
            </article>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
