import type { Doc } from '@/lib/legal-content'

// Shared with app/legal/[doc]/page.tsx and terms-modal.tsx — the modal a
// café owner scrolls through during signup/checkout renders the exact same
// content and markup structure as the full standalone /legal/[doc] page,
// not a second hand-kept copy. `variant` only changes type scale/heading
// level between the compact modal and the full-width standalone page —
// same data, same structure, same section-by-section rendering either way.

export function LegalDocBody({
  doc,
  showReview = true,
  variant = 'modal',
}: {
  doc: Doc
  showReview?: boolean
  variant?: 'modal' | 'page'
}) {
  const Heading = variant === 'page' ? 'h2' : 'h3'
  const sizes = variant === 'page'
    ? { intro: 'text-[15px]', heading: 'text-[17px]', p: 'text-[14.5px]', gap: 'mt-8' }
    : { intro: 'text-[14.5px]', heading: 'text-[15px]', p: 'text-[13.5px]', gap: 'mt-6' }

  return (
    <>
      <p className={`${sizes.intro} leading-relaxed text-muted-foreground`}>{doc.intro}</p>

      {doc.sections.map((s) => (
        <section key={s.h} className={sizes.gap}>
          <Heading className={`${sizes.heading} font-semibold tracking-tight text-foreground`}>{s.h}</Heading>
          {s.p?.map((para, i) => (
            <p key={i} className={`mt-2 ${sizes.p} leading-relaxed text-muted-foreground`}>{para}</p>
          ))}
          {s.list && (
            <ul className="mt-2 space-y-1.5">
              {s.list.map((li, i) => (
                <li key={i} className={`flex gap-2 ${sizes.p} leading-relaxed text-muted-foreground`}>
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                  <span>{li}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {showReview && doc.review && (
        <div className="mt-6 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-[12.5px] leading-relaxed text-warning">
          <strong className="font-semibold">Requires professional review.</strong> {doc.review}
        </div>
      )}
    </>
  )
}
