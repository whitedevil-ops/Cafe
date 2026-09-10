import { bricolageGrotesque } from '@/lib/marketing-font'

// Scopes the Bricolage Grotesque display face to the public marketing pages
// that actually render it (home, pricing, about, contact, blog, the
// restaurant-pos-software landing pages) instead of loading it from the
// root layout, where every /dashboard and /ops page — the ones staff hit
// hundreds of times a day — paid for a font file they never display.
// `contents` keeps this div out of the box model entirely; it exists only
// to carry the CSS variable, which inherits to children regardless.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${bricolageGrotesque.variable} contents`}>{children}</div>
}
