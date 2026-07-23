'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export type InventoryItem = {
  id: string
  name: string
  sku: string | null
  unit: string
  current_stock: number
  min_stock: number
  cost: number | null
  supplier: string | null
}

const REASON_PRESETS = ['Delivery received', 'Wastage', 'Used in kitchen', 'Stock count correction']

export default function InventoryClient({
  cafeId,
  initialItems,
}: {
  cafeId: string
  initialItems: InventoryItem[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [items, setItems] = useState(initialItems)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [unit, setUnit] = useState('kg')
  const [minStock, setMinStock] = useState('0')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [movingId, setMovingId] = useState<string | null>(null)
  const [moveDelta, setMoveDelta] = useState('')
  const [moveDirection, setMoveDirection] = useState<'in' | 'out'>('in')
  const [moveReason, setMoveReason] = useState(REASON_PRESETS[0])
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  async function addItem() {
    if (!name.trim()) return setError('Item name is required.')
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('inventory_items')
      .insert({
        cafe_id: cafeId,
        name: name.trim(),
        sku: sku.trim() || null,
        unit: unit.trim() || 'unit',
        min_stock: Number(minStock) || 0,
        cost: cost ? Math.round(Number(cost)) : null,
        supplier: supplier.trim() || null,
      })
      .select('id, name, sku, unit, current_stock, min_stock, cost, supplier')
      .single()
    setSaving(false)
    if (err) return setError(err.message)
    setItems((list) => [...list, data as InventoryItem].sort((a, b) => a.name.localeCompare(b.name)))
    setName(''); setSku(''); setMinStock('0'); setCost(''); setSupplier('')
    setAdding(false)
    toast('Item added.')
  }

  async function recordMovement(item: InventoryItem) {
    const qty = Number(moveDelta)
    if (!qty || qty <= 0) return setMoveError('Enter a quantity greater than 0.')
    const delta = moveDirection === 'in' ? qty : -qty
    setMoving(true)
    setMoveError(null)
    const { data, error: err } = await supabase.rpc('record_inventory_movement', {
      p_cafe_id: cafeId,
      p_item_id: item.id,
      p_delta: delta,
      p_reason: moveReason,
    })
    setMoving(false)
    if (err) return setMoveError(err.message)
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, current_stock: data as number } : i)))
    setMovingId(null)
    setMoveDelta('')
    toast(`${item.name}: ${delta > 0 ? '+' : ''}${delta} ${item.unit}`)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inventory</h1>
        <button onClick={() => setAdding((v) => !v)} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover">
          {adding ? 'Cancel' : 'Add item'}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Track what&apos;s on hand and log every delivery, use, and wastage against it.
      </p>

      {adding && (
        <section className="mt-4 rounded-xl border border-border bg-surface p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Item name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Milk" />
            <Input label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg / litre / unit" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Low-stock threshold" type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            <Input label="Cost per unit (₹, optional)" type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="SKU (optional)" value={sku} onChange={(e) => setSku(e.target.value)} />
            <Input label="Supplier (optional)" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          {error && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}
          <Button onClick={addItem} loading={saving} className="mt-4">Add item</Button>
        </section>
      )}

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No inventory items yet.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((item) => {
            const low = item.current_stock < item.min_stock
            return (
              <li key={item.id} className={`rounded-xl border p-4 ${low ? 'border-destructive bg-destructive-subtle' : 'border-border bg-surface'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {item.name}
                      {item.sku && <span className="ml-2 text-[12px] font-normal text-muted-foreground">{item.sku}</span>}
                    </p>
                    <p className={`text-[13px] ${low ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                      {item.current_stock} {item.unit} on hand
                      {low && ` — below threshold of ${item.min_stock} ${item.unit}`}
                      {item.supplier && ` · ${item.supplier}`}
                    </p>
                  </div>
                  <button
                    onClick={() => { setMovingId(movingId === item.id ? null : item.id); setMoveError(null); setMoveDelta('') }}
                    className="min-h-9 shrink-0 rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle"
                  >
                    Record movement
                  </button>
                </div>

                {movingId === item.id && (
                  <div className="mt-3 rounded-[var(--radius)] border border-border bg-surface p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMoveDirection('in')}
                        className={`min-h-9 flex-1 rounded-[var(--radius)] border text-[12.5px] font-medium ${moveDirection === 'in' ? 'border-success bg-success-subtle text-success' : 'border-border-strong text-muted-foreground'}`}
                      >
                        Stock in (+)
                      </button>
                      <button
                        onClick={() => setMoveDirection('out')}
                        className={`min-h-9 flex-1 rounded-[var(--radius)] border text-[12.5px] font-medium ${moveDirection === 'out' ? 'border-destructive bg-destructive-subtle text-destructive' : 'border-border-strong text-muted-foreground'}`}
                      >
                        Stock out (−)
                      </button>
                    </div>
                    <div className="mt-2">
                      <Input label={`Quantity (${item.unit})`} type="number" min={0} value={moveDelta} onChange={(e) => setMoveDelta(e.target.value)} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {REASON_PRESETS.map((r) => (
                        <button
                          key={r}
                          onClick={() => setMoveReason(r)}
                          className={`min-h-8 rounded-full border px-3 text-[12px] ${moveReason === r ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    {moveError && <p className="mt-2 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{moveError}</p>}
                    <Button onClick={() => recordMovement(item)} loading={moving} size="sm" className="mt-3">Confirm</Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
