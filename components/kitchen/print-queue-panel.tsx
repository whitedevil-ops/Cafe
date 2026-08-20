'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDateTime } from '@/lib/datetime'

type PrintJobRow = {
  id: string
  kind: string
  status: 'pending' | 'printing' | 'printed' | 'failed'
  created_at: string
  completed_at: string | null
  error: string | null
}

const KIND_LABEL: Record<string, string> = {
  kot: 'AUTO',
  kot_update: 'AUTO · UPDATE',
  reprint: 'REPRINT',
  test: 'TEST',
}

const STATUS_CLS: Record<PrintJobRow['status'], string> = {
  pending: 'text-muted-foreground',
  printing: 'text-muted-foreground',
  printed: 'text-success',
  failed: 'text-destructive',
}

/**
 * Recent print_jobs for this café — the KOT history/audit view the spec
 * asks for (every automatic print, reprint, and failure, with who/when).
 * Read-only: print_jobs itself is written only by the enqueue trigger and
 * the SECURITY DEFINER reprint/test RPCs, never directly by staff (see the
 * table's own RLS comment in 0027_kot_printing.sql) — this component never
 * inserts or updates a row, only lists them.
 */
export default function PrintQueuePanel({ cafeId, timezone }: { cafeId: string; timezone: string }) {
  const supabase = createClient()
  const [jobs, setJobs] = useState<PrintJobRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('print_jobs')
      .select('id, kind, status, created_at, completed_at, error')
      .eq('cafe_id', cafeId)
      .order('created_at', { ascending: false })
      .limit(30)
    setJobs((data ?? []) as PrintJobRow[])
    setLoading(false)
  }, [supabase, cafeId])

  useEffect(() => {
    // refresh() is async and only calls setState after its own network
    // round-trip completes — not a synchronous render-phase update — but
    // this lint rule can't see past the `void` once refresh is a useCallback
    // reference rather than a function declared inline in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const counts = jobs.reduce(
    (acc, j) => ({ ...acc, [j.status]: (acc[j.status] ?? 0) + 1 }),
    {} as Partial<Record<PrintJobRow['status'], number>>,
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
          <History size={14} /> Print history
        </h3>
        <button
          onClick={() => void refresh()}
          aria-label="Refresh print history"
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        The last {jobs.length} print jobs for this café — automatic KOTs, manual reprints, and test prints,
        whichever printer they went to.
      </p>

      {jobs.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">
          {loading ? 'Loading…' : 'Nothing printed yet.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-[var(--radius)] border border-border-strong">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[12.5px]">
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground">
                    {KIND_LABEL[j.kind] ?? j.kind.toUpperCase()}
                  </span>
                  <span className={`font-medium ${STATUS_CLS[j.status]}`}>
                    {j.status === 'printing' ? 'sending…' : j.status}
                  </span>
                </p>
                {j.error && <p className="mt-0.5 truncate text-[11px] text-destructive">{j.error}</p>}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatDateTime(j.completed_at ?? j.created_at, timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {Object.keys(counts).length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {(['printed', 'pending', 'printing', 'failed'] as const)
            .filter((s) => counts[s])
            .map((s) => `${counts[s]} ${s}`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
