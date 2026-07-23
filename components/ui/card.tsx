import type { ReactNode } from 'react'

// The one card primitive. Subtle hairline border, near-flat surface — cards
// group meaning, they are not the decoration. No nested cards, no heavy
// shadows; that's a deliberate house rule, enforced by having exactly one.
export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={`rounded-[var(--radius-lg)] border border-border bg-surface ${padded ? 'p-5 sm:p-6' : ''} ${className}`}>
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  description,
  action,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
