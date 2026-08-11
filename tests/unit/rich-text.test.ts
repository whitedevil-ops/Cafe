import { describe, it, expect } from 'vitest'
import { plainText } from '@/lib/rich-text'
import { ARTICLES } from '@/lib/blog'

describe('plainText', () => {
  it('strips bold markers', () => {
    expect(plainText('a **bold** word')).toBe('a bold word')
  })

  it('keeps link labels and drops the target', () => {
    expect(plainText('see the [pricing page](/pricing) for more')).toBe(
      'see the pricing page for more',
    )
  })

  it('handles both in one string', () => {
    expect(plainText('**Portion discipline.** See [inventory](/x).')).toBe(
      'Portion discipline. See inventory.',
    )
  })

  it('leaves plain prose untouched', () => {
    expect(plainText('nothing to strip here')).toBe('nothing to strip here')
  })
})

describe('blog content invariants', () => {
  it('has unique slugs', () => {
    const slugs = ARTICLES.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('keeps <title> short enough not to be truncated in results', () => {
    for (const a of ARTICLES) expect(a.title.length, a.slug).toBeLessThanOrEqual(60)
  })

  it('keeps meta descriptions in the range search engines display', () => {
    for (const a of ARTICLES) {
      expect(a.description.length, a.slug).toBeGreaterThanOrEqual(70)
      expect(a.description.length, a.slug).toBeLessThanOrEqual(180)
    }
  })

  it('uses ISO dates', () => {
    for (const a of ARTICLES) {
      expect(a.published, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(a.published)), a.slug).toBe(false)
    }
  })

  it('starts every article with an h1-worthy body and at least two h2 sections', () => {
    for (const a of ARTICLES) {
      const h2s = a.body.filter((b) => b.t === 'h2')
      expect(h2s.length, a.slug).toBeGreaterThanOrEqual(2)
    }
  })

  it('only links internally to paths, never to bare slugs', () => {
    for (const a of ARTICLES) {
      for (const r of a.related) {
        expect(r.href.startsWith('/') || r.href.startsWith('https://'), `${a.slug} → ${r.href}`).toBe(true)
      }
    }
  })

  it('gives every table row the same number of cells as the header', () => {
    for (const a of ARTICLES) {
      for (const block of a.body) {
        if (block.t !== 'table') continue
        for (const row of block.rows) expect(row.length, a.slug).toBe(block.head.length)
      }
    }
  })
})
