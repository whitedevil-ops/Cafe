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
  // Canonical config (same cafe_tables/floor_areas the owner sets up).
  areaId: string | null
  capacity: number | null
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
    return 'border-destructive bg-destructive-subtle'
  }
  if (t.status === 'reserved') return 'border-warning bg-warning-subtle'
  return 'border-border-strong bg-surface hover:border-primary'
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
  // Floor tabs from configured areas + a bucket for any unassigned tables.
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

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">Select a table</h2>
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
            <p className="py-10 text-center text-sm text-muted-foreground">No tables in this floor yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sorted.map((t) => (
                <button key={t.id} onClick={() => onPick(t)} className={`min-h-24 rounded-[var(--radius)] border-2 p-3 text-left transition-colors ${tint(t)}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-semibold text-foreground">{t.label}</span>
                    {t.capacity != null && <span className="text-[11px] text-muted-foreground">{t.capacity} seats</span>}
                  </div>
                  {t.sessionId ? (
                    <div className="mt-1">
                      <p className="text-[13px] font-semibold text-foreground">₹{t.bill}{t.due > 0 && <span className="text-[11px] font-medium text-destructive"> · ₹{t.due} due</span>}</p>
                      <p className="text-[11px] font-medium">
                        {t.payState === 'paid' ? <span className="text-success">● PAID</span>
                          : t.payState === 'partial' ? <span className="text-warning">● PARTIAL</span>
                          : <span className="text-destructive">● PAYMENT DUE</span>}
                      </p>
                      {(t.waiterCalled || t.billRequested || t.ready) && (
                        <p className="text-[10.5px] font-medium text-[#7C3AED]">{t.waiterCalled ? 'Waiter called' : t.billRequested ? 'Bill requested' : 'Ready'}</p>
                      )}
                    </div>
                  ) : (
                    <p className={`mt-1 text-[12.5px] font-medium ${t.status === 'reserved' ? 'text-warning' : 'text-muted-foreground'}`}>{t.status === 'reserved' ? 'Reserved' : 'Available'}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
