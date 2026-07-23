'use client'

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
}

export function TableSelector({
  tables,
  onPick,
  onClose,
}: {
  tables: LiveTable[]
  onPick: (table: LiveTable) => void
  onClose: () => void
}) {
  const sorted = [...tables].sort(byTableLabel)

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface sm:max-h-[80dvh] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">Choose a table</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center text-muted-foreground">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sorted.map((t) => {
              const occupied = t.status === 'occupied' && t.sessionId
              let border = 'border-border-strong bg-surface hover:border-primary'
              if (occupied) border = 'border-success bg-success-subtle'
              else if (t.status === 'reserved') border = 'border-warning bg-warning-subtle'

              return (
                <button
                  key={t.id}
                  onClick={() => onPick(t)}
                  className={`min-h-20 rounded-[var(--radius)] border-2 p-3 text-left transition-colors ${border}`}
                >
                  <p className="text-[15px] font-semibold text-foreground">{t.label}</p>
                  {occupied ? (
                    <>
                      <p className="mt-0.5 text-[13px] font-medium text-foreground">₹{t.bill}</p>
                      <p className="text-[11.5px] text-muted-foreground">{t.itemCount} item{t.itemCount === 1 ? '' : 's'} · occupied</p>
                    </>
                  ) : (
                    <p className={`mt-0.5 text-[12.5px] font-medium ${t.status === 'reserved' ? 'text-warning' : 'text-muted-foreground'}`}>
                      {t.status === 'reserved' ? 'Reserved' : 'Available'}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
          {sorted.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No tables set up yet.</p>}
        </div>
      </div>
    </div>
  )
}
