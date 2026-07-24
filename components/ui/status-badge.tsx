// One shared pill for financial/operational state across POS, Live Tables and
// Bills — so "Payment Due" always looks and reads identically everywhere.
// Never communicates state by color alone: the label is the source of truth,
// color is reinforcement.
export type Status = 'paid' | 'partial' | 'due' | 'available' | 'neutral'

const STYLE: Record<Status, string> = {
  paid: 'border-success bg-success-subtle text-success',
  partial: 'border-warning bg-warning-subtle text-warning',
  due: 'border-destructive bg-destructive-subtle text-destructive',
  available: 'border-border-strong bg-surface-subtle text-muted-foreground',
  neutral: 'border-border bg-surface-subtle text-muted-foreground',
}

export function StatusBadge({ status, children, className = '' }: { status: Status; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold leading-none ${STYLE[status]} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  )
}
