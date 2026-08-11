import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'

// A deliberately tiny inline-markup renderer for blog prose. Two constructs
// only — **bold** and [text](/path) — because that is everything the articles
// actually use, and a full markdown dependency for two constructs is a
// dependency you maintain forever for nothing.
//
// Split on both patterns in one pass so a link inside bold (or the reverse)
// can't produce half-parsed output: whichever matches first wins, and the
// remainder is re-scanned.

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g

export function richText(text: string): ReactNode {
  const parts = text.split(TOKEN).filter((p) => p !== '')

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const [, label, href] = link
      const external = href.startsWith('http')
      return external ? (
        <a key={i} href={href} rel="noopener" className="font-medium text-primary hover:underline">
          {label}
        </a>
      ) : (
        <Link key={i} href={href} className="font-medium text-primary hover:underline">
          {label}
        </Link>
      )
    }

    return <Fragment key={i}>{part}</Fragment>
  })
}

/** The same text with markup stripped — for meta descriptions and JSON-LD,
 *  where raw `**` and bracket syntax would leak into search results. */
export function plainText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}
