import type { ReactNode } from 'react'

// One page header. Title stays modest (restaurant software needs density, not
// billboard headings); optional verified badge, subtitle, and a right-aligned
// action slot for the primary page action.
export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-[13.5px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
