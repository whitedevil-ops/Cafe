'use client'

import { X, Clock } from 'lucide-react'

export type HeldOrder = {
  id: string
  order_type: 'dine_in' | 'takeaway'
  table_id: string | null
  table_label: string | null
  customer_name: string | null
  customer_phone: string | null
  label: string | null
  created_at: string
  itemCount: number
  total: number
}

export function HeldOrdersDrawer({
  orders,
  onResume,
  onDiscard,
  onClose,
}: {
  orders: HeldOrder[]
  onResume: (id: string) => void
  onDiscard: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:max-h-[80dvh] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">Held orders</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center text-muted-foreground">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No held orders.</p>
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.id} className="rounded-[var(--radius)] border border-border-strong p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-foreground">
                        {o.order_type === 'dine_in' ? (o.table_label ?? 'Table') : 'Takeaway'}
                        {o.customer_name ? ` · ${o.customer_name}` : ''}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · ₹{o.total}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock size={11} /> {new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onDiscard(o.id)}
                      className="min-h-9 flex-1 rounded-[var(--radius-sm)] border border-border-strong text-[12.5px] font-medium text-muted-foreground"
                    >
                      Discard
                    </button>
                    <button
                      onClick={() => onResume(o.id)}
                      className="min-h-9 flex-1 rounded-[var(--radius-sm)] bg-primary text-[12.5px] font-medium text-primary-foreground"
                    >
                      Resume
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
