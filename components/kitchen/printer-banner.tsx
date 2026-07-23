'use client'

import { Printer, PrinterCheck } from 'lucide-react'

export type PrinterHealth = {
  enabled: boolean
  bridge_last_seen: string | null
  /** Computed server-side, so a kitchen tablet with a skewed clock can't
   *  misreport a healthy bridge as offline. */
  bridge_online: boolean
  failed_jobs: number
  pending_jobs: number
  printers: { id: string; name: string; enabled: boolean; last_seen_at: string | null; last_error: string | null }[]
}

// The whole point of this banner is reassurance, not alarm. A dead printer is
// an inconvenience; the message must make clear the kitchen has NOT lost the
// order, because a cook who thinks tickets are missing will start guessing.
export function PrinterBanner({ health }: { health: PrinterHealth | null }) {
  if (!health?.enabled) return null

  const bridgeOnline = health.bridge_online
  const broken = health.printers.filter((p) => p.enabled && p.last_error)

  // Everything healthy and nothing stuck: one quiet line, no colour.
  if (bridgeOnline && broken.length === 0 && health.failed_jobs === 0) {
    return (
      <p className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <PrinterCheck size={14} className="text-success" />
        KOT printing active
        {health.pending_jobs > 0 && ` · ${health.pending_jobs} in queue`}
      </p>
    )
  }

  const headline = !bridgeOnline
    ? 'Print bridge offline'
    : broken.length === 1
      ? `${broken[0].name} offline`
      : broken.length > 1
        ? `${broken.length} printers offline`
        : `${health.failed_jobs} KOT${health.failed_jobs === 1 ? '' : 's'} failed to print`

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-warning bg-warning-subtle px-4 py-2.5">
      <Printer size={15} className="shrink-0 text-warning" />
      <span className="text-[13.5px] font-medium text-warning">{headline}</span>
      <span className="text-[13px] text-warning/90">— Digital KDS is still active. Orders are not affected.</span>
    </div>
  )
}
