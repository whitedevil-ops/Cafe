'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { byTableLabel } from '@/lib/table-sort'

export type LiveTable = {
  id: string
  label: string
  status: 'available' | 'occupied' | 'reserved' | 'cleaning'
  sessionId: string | null
  bill: number
  itemCount: number
  items: { name: string; qty: number }[]
  // Layout (same canonical cafe_tables/floor_areas the owner configures).
  areaId: string | null
  posX: number | null
  posY: number | null
  shape: 'square' | 'rectangle' | 'round'
  // Live money + operational state.
  paid: number
  due: number
  payState: 'paid' | 'partial' | 'unpaid' | null
  billRequested: boolean
  ready: boolean
  waiterCalled: boolean
  mins: number | null
}

export type TableArea = { id: string; name: string }

const UNASSIGNED = '__none__'

function tint(t: LiveTable): string {
  if (t.sessionId) {
    if (t.payState === 'paid') return 'border-success bg-success-subtle'
    if (t.payState === 'partial') return 'border-warning bg-warning-subtle'
    return 'border-destructive bg-destructive-subtle' // occupied + due
  }
  if (t.status === 'reserved') return 'border-warning bg-warning-subtle'
  return 'border-border-strong bg-surface hover:border-primary'
}

function StatusLine({ t }: { t: LiveTable }) {
  if (!t.sessionId) {
    return <p className={`text-[12px] font-medium ${t.status === 'reserved' ? 'text-warning' : 'text-muted-foreground'}`}>{t.status === 'reserved' ? 'Reserved' : 'Available'}</p>
  }
  return (
    <>
      <p className="text-[13px] font-semibold text-foreground">₹{t.bill}{t.due > 0 && <span className="text-[11px] font-medium text-destructive"> · ₹{t.due} due</span>}</p>
      <p className="text-[11px] font-medium">
        {t.payState === 'paid' ? <span className="text-success">● PAID</span>
          : t.payState === 'partial' ? <span className="text-warning">● PARTIAL</span>
          : <span className="text-destructive">● PAYMENT DUE</span>}
      </p>
      {(t.ready || t.billRequested || t.waiterCalled) && (
        <p className="text-[10.5px] font-medium text-[#7C3AED]">
          {t.waiterCalled ? 'Waiter called' : t.billRequested ? 'Bill requested' : 'Ready'}
        </p>
      )}
    </>
  )
}

export function TableSelector({
  tables,
  areas,
  onPick,
  onClose,
}: {
  tables: LiveTable[]
  areas: TableArea[]
  onPick: (table: LiveTable) => void
  onClose: () => void
}) {
  // Build the tab set from configured areas, plus a bucket for any tables that
  // aren't assigned to an area (e.g. created before floors existed).
  const tabs = useMemo<TableArea[]>(() => {
    const list = [...areas]
    const hasLoose = tables.some((t) => !t.areaId || !areas.find((a) => a.id === t.areaId))
    if (hasLoose) list.push({ id: UNASSIGNED, name: areas.length ? 'Other' : 'Tables' })
    return list
  }, [areas, tables])

  const [active, setActive] = useState<string>(() => tabs[0]?.id ?? UNASSIGNED)

  const inActive = tables.filter((t) =>
    active === UNASSIGNED ? !t.areaId || !areas.find((a) => a.id === t.areaId) : t.areaId === active,
  )
  const sorted = [...inActive].sort(byTableLabel)
  // Use the visual map only if this area actually has positioned tables.
  const positioned = sorted.filter((t) => t.posX != null && t.posY != null)
  const useCanvas = positioned.length > 0 && positioned.length >= sorted.length - 1

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">Choose a table</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center text-muted-foreground"><X size={18} /></button>
        </div>

        {tabs.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
            {tabs.map((a) => (
              <button key={a.id} onClick={() => setActive(a.id)}
                className={`min-h-8 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${active === a.id ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'}`}>
                {a.name}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tables in this area yet.</p>
          ) : useCanvas ? (
            // Read-only replica of the owner's arrangement (normalised coords).
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,var(--color-border)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,var(--color-border)_24px)] bg-surface">
              {sorted.map((t, i) => {
                const x = t.posX ?? 0.12 + (i % 5) * 0.18
                const y = t.posY ?? 0.15 + Math.floor(i / 5) * 0.2
                const size = t.shape === 'rectangle' ? 'h-16 w-24' : t.shape === 'round' ? 'h-20 w-20 rounded-full' : 'h-18 w-18'
                return (
                  <button key={t.id} onClick={() => onPick(t)} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                    className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center border-2 p-1 text-center shadow-[var(--shadow-sm)] ${size} ${t.shape !== 'round' ? 'rounded-[var(--radius)]' : ''} ${tint(t)}`}>
                    <span className="text-[13px] font-semibold leading-none text-foreground">{t.label}</span>
                    <div className="mt-0.5 leading-tight"><StatusLine t={t} /></div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sorted.map((t) => (
                <button key={t.id} onClick={() => onPick(t)} className={`min-h-20 rounded-[var(--radius)] border-2 p-3 text-left transition-colors ${tint(t)}`}>
                  <span className="text-[15px] font-semibold text-foreground">{t.label}</span>
                  <div className="mt-0.5"><StatusLine t={t} /></div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
