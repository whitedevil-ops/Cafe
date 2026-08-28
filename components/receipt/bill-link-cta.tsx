import { ExternalLink } from 'lucide-react'

/**
 * The café owner's own configured link (Instagram, Google Maps, their
 * website — whatever they choose), shown unconditionally near the bottom of
 * the bill. Replaces the old star-rating feedback gate entirely: no rating
 * prompt, no KhaoPiyo-branded ask, just a direct link the owner controls.
 *
 * The URL itself already comes pre-filtered by get_receipt — it's null
 * whenever bill_link_enabled is false or nothing is configured, so hiding
 * here is a presentation nicety, not the actual security boundary; that
 * boundary is the RPC's own case-when plus the cafes table's scheme CHECK
 * constraint, neither of which a customer can influence from this page.
 */
export function BillLinkCta({ url, label }: { url: string | null; label: string | null }) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3.5 text-[13.5px] font-medium text-foreground hover:bg-surface-subtle print:hidden"
    >
      {label?.trim() || 'Visit Us'}
      <ExternalLink size={14} className="text-muted-foreground" />
    </a>
  )
}
