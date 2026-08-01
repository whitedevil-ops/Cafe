import { Check, X } from 'lucide-react'
import { Reveal } from './reveal'

// Framed against "a traditional setup" (the exact phrase already used in
// this site's own FAQ: "a bill book, a spreadsheet, and a separate ordering
// app") rather than any named competitor — every row here is a real,
// already-shipped KhaoPiyo capability, not a claim about what a specific
// rival product does or doesn't have.
const ROWS = [
  { label: 'Order taking', old: 'Handwritten or shouted to the kitchen', new: 'Live Kitchen Display, updates instantly' },
  { label: 'Customer ordering', old: 'Wait for a waiter to take the order', new: 'Guests scan a QR and order themselves' },
  { label: 'GST invoicing', old: 'Manual calculation, error-prone', new: 'Auto-calculated, numbered, always correct' },
  { label: 'Daily sales view', old: 'Add it up from the register tape', new: 'Live dashboard, any time, on your phone' },
  { label: 'Customer history', old: "No record of who's a regular", new: 'Every visit tracked automatically' },
  { label: 'Setup', old: 'Hardware to buy, a person to configure it', new: 'Sign up and take your first order today' },
]

export function ComparisonSection() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-20">
      <Reveal className="text-center">
        <h2 className="font-display text-[clamp(1.85rem,4vw,2.75rem)] font-semibold tracking-tight text-foreground">
          KhaoPiyo vs. a traditional setup.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
          Instead of a bill book, a spreadsheet, and a separate ordering app — one connected system.
        </p>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-10 overflow-hidden rounded-2xl border border-border">
          <div className="grid grid-cols-[1fr,1.4fr,1.4fr] border-b border-border bg-surface-subtle text-[12.5px] font-medium text-muted-foreground">
            <div className="p-4" />
            <div className="p-4">Traditional setup</div>
            <div className="p-4 text-primary">KhaoPiyo</div>
          </div>
          {ROWS.map((r, i) => (
            <div
              key={r.label}
              className={`grid grid-cols-[1fr,1.4fr,1.4fr] text-[13.5px] ${i % 2 === 0 ? 'bg-surface' : 'bg-surface-subtle/40'}`}
            >
              <div className="p-4 font-medium text-foreground">{r.label}</div>
              <div className="flex items-start gap-2 p-4 text-muted-foreground">
                <X size={15} className="mt-0.5 shrink-0 text-destructive/60" />
                {r.old}
              </div>
              <div className="flex items-start gap-2 p-4 text-foreground">
                <Check size={15} className="mt-0.5 shrink-0 text-success" />
                {r.new}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
