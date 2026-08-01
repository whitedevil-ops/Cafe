import { Star } from 'lucide-react'
import { Reveal } from './reveal'

// Only one real customer exists today (Brewora Café) and there are no other
// reviews yet — so this section shows Brewora's real, factual entry
// (no invented quote attributed to a person who wasn't asked) plus slots
// that are visibly labeled as samples, never presented as real reviews from
// people who don't exist.
export function TestimonialSpotlight() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <Reveal>
          <h2 className="font-display max-w-xl text-[clamp(1.85rem,4vw,2.75rem)] font-semibold tracking-tight text-foreground">
            Real café, running on KhaoPiyo today.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          <Reveal delay={0.05} className="lg:col-span-2">
            <div className="h-full rounded-2xl border border-primary/30 bg-primary-subtle/40 p-7">
              <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
                Verified pilot café
              </span>
              <p className="font-display mt-4 text-[19px] leading-relaxed text-foreground">
                Brewora Café in Hisar, Haryana runs its real day-to-day billing, QR ordering, and
                GST invoicing on KhaoPiyo — counter to kitchen to receipt, every day.
              </p>
              <div className="mt-5 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-primary text-[15px] font-semibold text-primary-foreground">
                  B
                </div>
                <div>
                  <p className="text-[14px] font-medium text-foreground">Brewora Café</p>
                  <p className="text-[13px] text-muted-foreground">Hisar, Haryana</p>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="relative h-full rounded-2xl border border-dashed border-border-strong bg-surface-subtle/60 p-7">
              <span className="absolute right-4 top-4 rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                Sample — real reviews coming soon
              </span>
              <div className="flex gap-0.5 text-primary/40">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={15} fill="currentColor" strokeWidth={0} />
                ))}
              </div>
              <p className="mt-4 text-[14px] italic leading-relaxed text-muted-foreground">
                &quot;This is where your café&apos;s story will go — reach out once you&apos;re
                live and we&apos;ll feature it here.&quot;
              </p>
              <p className="mt-5 text-[13px] font-medium text-muted-foreground">Your café, here next</p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
