'use client'

import { Store, Info } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/card'

type Provider = { key: string; name: string; blurb: string }

const PROVIDERS: Provider[] = [
  { key: 'swiggy', name: 'Swiggy', blurb: 'Orders would flow straight into this same KDS and Reports — no separate tablet.' },
  { key: 'zomato', name: 'Zomato', blurb: 'Orders would flow straight into this same KDS and Reports — no separate tablet.' },
  { key: 'ondc', name: 'ONDC', blurb: "India's open commerce network — buyer apps connect through a registered network participant." },
]

// Swiggy/Zomato don't offer a self-serve API a café can hand us a key for —
// unlike Razorpay above, POS access is granted by the aggregator to KhaoPiyo
// as a platform, then switched on per café. So there is nothing to "connect"
// here yet, and no per-café state to store: showing a form or a working
// toggle would be lying about a status that doesn't exist. This panel is
// intentionally read-only until that partner access exists.
export function IntegrationsPanel() {
  return (
    <Card>
      <CardHeader
        title="Aggregator integrations"
        description="Bring in orders from delivery platforms alongside dine-in, takeaway and QR."
      />

      <div className="mt-5 flex items-start gap-2 rounded-[var(--radius)] bg-info-subtle px-3 py-2.5 text-[12.5px] text-info">
        <Info size={15} className="mt-0.5 shrink-0" />
        <span>
          None of these are self-serve — Swiggy and Zomato only open order-integration access to a POS platform
          directly, not to individual cafés. KhaoPiyo hasn&apos;t been granted that access yet, so the honest status
          for every café right now is <strong>not connected</strong>. Once official access is in place, existing
          cafés switch on automatically — no re-setup on your end.
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {PROVIDERS.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-surface-subtle text-muted-foreground">
                <Store size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-foreground">{p.name}</p>
                <p className="truncate text-[12px] text-muted-foreground">{p.blurb}</p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Not connected
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
