import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'
import { ARTICLES, getArticle, type Block } from '@/lib/blog'
import { richText, plainText } from '@/lib/rich-text'
import {
  SITE_URL,
  articleJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdGraph,
} from '@/lib/seo'

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) return { title: 'Article not found' }

  return {
    title: article.title,
    description: article.description,
    keywords: article.keywords,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      url: `${SITE_URL}/blog/${article.slug}`,
      type: 'article',
      publishedTime: article.published,
      modifiedTime: article.updated ?? article.published,
    },
  }
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function renderBlock(block: Block, i: number) {
  switch (block.t) {
    case 'h2':
      return (
        <h2
          key={i}
          className="mt-12 text-[clamp(1.35rem,3vw,1.75rem)] font-semibold tracking-tight text-foreground"
        >
          {block.text}
        </h2>
      )
    case 'h3':
      return (
        <h3 key={i} className="mt-8 text-[17px] font-medium text-foreground">
          {block.text}
        </h3>
      )
    case 'p':
      return (
        <p key={i} className="mt-4 text-[16px] leading-[1.75] text-muted-foreground">
          {richText(block.text)}
        </p>
      )
    case 'ul':
      return (
        <ul key={i} className="mt-4 space-y-2.5 pl-5">
          {block.items.map((item, j) => (
            <li key={j} className="list-disc text-[15.5px] leading-[1.7] text-muted-foreground marker:text-border-strong">
              {richText(item)}
            </li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={i} className="mt-4 space-y-2.5 pl-5">
          {block.items.map((item, j) => (
            <li key={j} className="list-decimal text-[15.5px] leading-[1.7] text-muted-foreground marker:text-muted-foreground">
              {richText(item)}
            </li>
          ))}
        </ol>
      )
    case 'note':
      return (
        <aside
          key={i}
          className="mt-8 rounded-xl border border-border bg-surface p-5 text-[14.5px] leading-relaxed text-muted-foreground"
        >
          {richText(block.text)}
        </aside>
      )
    case 'table':
      return (
        <div key={i} className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[32rem] border-collapse text-left text-[14.5px]">
            <thead>
              <tr className="bg-surface">
                {block.head.map((h, j) => (
                  <th key={j} className="border-b border-border px-4 py-3 font-medium text-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, j) => (
                <tr key={j} className="border-b border-border last:border-b-0">
                  {row.map((cell, k) => (
                    <td
                      key={k}
                      className={`px-4 py-3 align-top leading-relaxed ${
                        k === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {richText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) notFound()

  const graph: object[] = [
    articleJsonLd({
      title: article.title,
      description: article.description,
      path: `/blog/${article.slug}`,
      published: article.published,
      updated: article.updated,
    }),
    breadcrumbJsonLd([
      { name: 'Blog', path: '/blog' },
      { name: article.title, path: `/blog/${article.slug}` },
    ]),
  ]
  if (article.faqs?.length) graph.push(faqJsonLd(article.faqs))

  return (
    <div className="min-h-dvh bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdGraph(...graph) }} />
      <SiteHeader />

      <article className="mx-auto w-full max-w-[46rem] px-6 pt-16 pb-10">
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted-foreground">
          <Link href="/blog" className="hover:text-primary">
            Blog
          </Link>
        </nav>

        <h1 className="mt-4 font-display text-[clamp(1.9rem,4.5vw,2.75rem)] font-semibold leading-[1.12] tracking-tight text-foreground">
          {article.h1}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
          <time dateTime={article.published}>{formatDate(article.published)}</time>
          <span aria-hidden>·</span>
          <span>{article.readingMinutes} min read</span>
          {article.updated && (
            <>
              <span aria-hidden>·</span>
              <span>Updated {formatDate(article.updated)}</span>
            </>
          )}
        </div>

        <p className="mt-6 border-l-2 border-primary pl-4 text-[17px] leading-relaxed text-foreground">
          {plainText(article.excerpt)}
        </p>

        <div className="mt-8">{article.body.map(renderBlock)}</div>
      </article>

      {article.faqs?.length ? (
        <section className="border-y border-border bg-surface">
          <div className="mx-auto w-full max-w-[46rem] px-6 py-14">
            <h2 className="text-[clamp(1.35rem,3vw,1.75rem)] font-semibold tracking-tight text-foreground">
              Frequently asked questions
            </h2>
            <div className="mt-8 divide-y divide-border border-t border-border">
              {article.faqs.map((f) => (
                <div key={f.q} className="py-5">
                  <h3 className="text-[15px] font-medium text-foreground">{f.q}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto w-full max-w-[46rem] px-6 py-14">
        <h2 className="text-[15px] font-medium text-foreground">Read next</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {article.related.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="rounded-xl border border-border bg-surface p-5 text-sm font-medium text-foreground hover:border-border-strong"
            >
              {r.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-14 text-center">
          <h2 className="text-[clamp(1.25rem,3vw,1.6rem)] font-semibold tracking-tight text-foreground">
            Run your café on KhaoPiyo
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Billing, GST invoices, QR ordering, the kitchen screen and inventory in one system. Set
            up your menu before paying anything.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/get-started">
              <Button size="lg">Start free</Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="secondary">
                See pricing
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
