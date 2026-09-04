'use client'

import { useCallback, useMemo, useState } from 'react'
import { Truck, Plus, X, Package, ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { formatDate } from '@/lib/datetime'

export type Supplier = {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  active: boolean
  created_at: string
}

export type InventoryItemOption = { id: string; name: string; unit: string }

type Rel<T> = T | T[] | null
function one<T>(v: Rel<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export type PurchaseOrderItem = {
  id: string
  inventory_item_id: string
  qty_ordered: number
  qty_received: number
  unit_cost: number | null
  inventory_items: Rel<{ name: string; unit: string }>
}

export type PurchaseOrder = {
  id: string
  status: 'ordered' | 'partially_received' | 'received' | 'cancelled'
  order_date: string
  expected_date: string | null
  notes: string | null
  cancel_reason: string | null
  created_at: string
  suppliers: Rel<{ name: string }>
  purchase_order_items: PurchaseOrderItem[]
}

const STATUS_BADGE: Record<PurchaseOrder['status'], { label: string; cls: string }> = {
  ordered: { label: 'Ordered', cls: 'bg-info-subtle text-info border-info' },
  partially_received: { label: 'Partially received', cls: 'bg-warning-subtle text-warning border-warning' },
  received: { label: 'Received', cls: 'bg-success-subtle text-success border-success' },
  cancelled: { label: 'Cancelled', cls: 'bg-surface-subtle text-muted-foreground border-border-strong' },
}

type DraftLine = { inventoryItemId: string; qty: string; unitCost: string }

const PURCHASE_ORDER_SELECT =
  'id, status, order_date, expected_date, notes, cancel_reason, created_at, suppliers(name), purchase_order_items(id, inventory_item_id, qty_ordered, qty_received, unit_cost, inventory_items(name, unit))'

export default function PurchasesClient({
  cafeId,
  role,
  initialSuppliers,
  initialOrders,
  initialOrdersCount,
  inventoryItems,
}: {
  cafeId: string
  role: string
  initialSuppliers: Supplier[]
  initialOrders: PurchaseOrder[]
  initialOrdersCount: number
  inventoryItems: InventoryItemOption[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const isAdmin = role === 'owner' || role === 'manager'

  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders')
  const [suppliers, setSuppliers] = useState(initialSuppliers)
  const [orders, setOrders] = useState(initialOrders)
  const [ordersCount, setOrdersCount] = useState(initialOrdersCount)
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false)

  // Mirrors bills-client's Load more — purchase orders were previously
  // fetched in full (every order the cafe has ever placed) with no bound.
  const loadMoreOrders = useCallback(async () => {
    setLoadingMoreOrders(true)
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(PURCHASE_ORDER_SELECT)
      .eq('cafe_id', cafeId)
      .order('created_at', { ascending: false })
      .range(orders.length, orders.length + 99)
    setLoadingMoreOrders(false)
    if (error) return toast(error.message, 'error')
    setOrders((list) => [...list, ...((data ?? []) as unknown as PurchaseOrder[])])
  }, [supabase, cafeId, orders.length, toast])

  // ── Suppliers ──────────────────────────────────────────────────────────
  const [supName, setSupName] = useState('')
  const [supContact, setSupContact] = useState('')
  const [supPhone, setSupPhone] = useState('')
  const [supEmail, setSupEmail] = useState('')
  const [supNotes, setSupNotes] = useState('')
  const [savingSupplier, setSavingSupplier] = useState(false)
  const [supplierError, setSupplierError] = useState<string | null>(null)

  async function createSupplier() {
    if (!supName.trim()) return setSupplierError('Enter a supplier name.')
    setSavingSupplier(true)
    setSupplierError(null)
    const { data, error } = await supabase.rpc('create_supplier', {
      p_cafe_id: cafeId, p_name: supName.trim(), p_contact_name: supContact.trim() || null,
      p_phone: supPhone.trim() || null, p_email: supEmail.trim() || null, p_address: null, p_notes: supNotes.trim() || null,
    })
    setSavingSupplier(false)
    if (error) return setSupplierError(error.message)
    setSuppliers((list) => [...list, data as Supplier].sort((a, b) => a.name.localeCompare(b.name)))
    setSupName(''); setSupContact(''); setSupPhone(''); setSupEmail(''); setSupNotes('')
    toast(`Supplier "${(data as Supplier).name}" added.`)
  }

  async function toggleSupplier(s: Supplier) {
    setSuppliers((list) => list.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)))
    const { error } = await supabase.rpc('set_supplier_active', { p_supplier_id: s.id, p_active: !s.active })
    if (error) {
      setSuppliers((list) => list.map((x) => (x.id === s.id ? { ...x, active: s.active } : x)))
      toast(error.message, 'error')
    }
  }

  // ── Create purchase order ─────────────────────────────────────────────
  const [creating, setCreating] = useState(false)
  const [poSupplierId, setPoSupplierId] = useState('')
  const [poExpected, setPoExpected] = useState('')
  const [poNotes, setPoNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ inventoryItemId: '', qty: '', unitCost: '' }])
  const [savingPo, setSavingPo] = useState(false)
  const [poError, setPoError] = useState<string | null>(null)

  function addLine() {
    setLines((l) => [...l, { inventoryItemId: '', qty: '', unitCost: '' }])
  }
  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i))
  }
  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  }

  async function createOrder() {
    if (!poSupplierId) return setPoError('Choose a supplier.')
    const items = lines
      .filter((l) => l.inventoryItemId && Number(l.qty) > 0)
      .map((l) => ({ inventory_item_id: l.inventoryItemId, qty: Number(l.qty), unit_cost: l.unitCost ? Math.round(Number(l.unitCost)) : null }))
    if (items.length === 0) return setPoError('Add at least one item with a quantity.')

    setSavingPo(true)
    setPoError(null)
    const { data, error } = await supabase.rpc('create_purchase_order', {
      p_cafe_id: cafeId, p_supplier_id: poSupplierId, p_items: items,
      p_expected_date: poExpected || null, p_notes: poNotes.trim() || null,
    })
    setSavingPo(false)
    if (error) return setPoError(error.message)

    const supplier = suppliers.find((s) => s.id === poSupplierId)
    const newOrder: PurchaseOrder = {
      id: (data as { purchase_order_id: string }).purchase_order_id,
      status: 'ordered',
      order_date: new Date().toISOString().slice(0, 10),
      expected_date: poExpected || null,
      notes: poNotes.trim() || null,
      cancel_reason: null,
      created_at: new Date().toISOString(),
      suppliers: { name: supplier?.name ?? '' },
      purchase_order_items: items.map((it, i) => ({
        id: `temp-${i}`, inventory_item_id: it.inventory_item_id, qty_ordered: it.qty, qty_received: 0,
        unit_cost: it.unit_cost, inventory_items: { name: inventoryItems.find((ii) => ii.id === it.inventory_item_id)?.name ?? '', unit: inventoryItems.find((ii) => ii.id === it.inventory_item_id)?.unit ?? '' },
      })),
    }
    setOrders((list) => [newOrder, ...list])
    setOrdersCount((n) => n + 1)
    setCreating(false)
    setPoSupplierId(''); setPoExpected(''); setPoNotes(''); setLines([{ inventoryItemId: '', qty: '', unitCost: '' }])
    toast('Purchase order created.')
  }

  // ── Receiving + cancelling ─────────────────────────────────────────────
  const [expanded, setExpanded] = useState<string | null>(null)
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({})
  const [receiving, setReceiving] = useState(false)
  const [receiveError, setReceiveError] = useState<string | null>(null)

  async function confirmReceive(po: PurchaseOrder) {
    const items = po.purchase_order_items
      .map((it) => ({ po_item_id: it.id, qty_received: Number(receiveQty[it.id] ?? '') }))
      .filter((it) => it.qty_received > 0)
    if (items.length === 0) return setReceiveError('Enter a quantity for at least one item.')

    setReceiving(true)
    setReceiveError(null)
    const { data, error } = await supabase.rpc('receive_purchase_order_items', {
      p_purchase_order_id: po.id, p_items: items,
    })
    setReceiving(false)
    if (error) return setReceiveError(error.message)

    const newStatus = (data as { status: PurchaseOrder['status'] }).status
    setOrders((list) => list.map((o) => (o.id === po.id ? {
      ...o, status: newStatus,
      purchase_order_items: o.purchase_order_items.map((it) => {
        const recv = items.find((x) => x.po_item_id === it.id)
        return recv ? { ...it, qty_received: it.qty_received + recv.qty_received } : it
      }),
    } : o)))
    setReceiveQty({})
    toast('Stock received.')
  }

  async function cancelOrder(po: PurchaseOrder) {
    const reason = window.prompt('Reason for cancelling this purchase order?')
    if (!reason || !reason.trim()) return
    const { error } = await supabase.rpc('cancel_purchase_order', { p_purchase_order_id: po.id, p_reason: reason.trim() })
    if (error) return toast(error.message, 'error')
    setOrders((list) => list.map((o) => (o.id === po.id ? { ...o, status: 'cancelled', cancel_reason: reason.trim() } : o)))
    toast('Purchase order cancelled.')
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader title="Purchases & suppliers" subtitle="Track what you order, from whom, and receive it straight into inventory." />

      {!isAdmin && (
        <p className="mt-4 rounded-[var(--radius)] bg-warning-subtle px-3 py-2.5 text-[13px] text-warning">
          Some actions (creating orders, adding suppliers) need an owner or manager. You can still receive stock.
        </p>
      )}

      <div className="mt-6 flex gap-2">
        {(['orders', 'suppliers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-10 rounded-[var(--radius)] border px-4 text-[13px] font-medium transition-colors ${
              tab === t ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {t === 'orders' ? 'Purchase orders' : 'Suppliers'}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <div className="mt-5">
          {isAdmin && !creating && (
            <Button onClick={() => setCreating(true)} disabled={suppliers.length === 0}>
              <Plus size={15} /> New purchase order
            </Button>
          )}
          {isAdmin && suppliers.length === 0 && (
            <p className="mt-2 text-[12.5px] text-muted-foreground">Add a supplier first, on the Suppliers tab.</p>
          )}

          {creating && (
            <Card className="mt-4">
              <CardHeader title="New purchase order" action={<button onClick={() => setCreating(false)} aria-label="Cancel" className="grid h-10 w-10 place-items-center text-muted-foreground hover:text-foreground"><X size={16} /></button>} />
              <div className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-foreground">Supplier</label>
                  <select
                    value={poSupplierId}
                    onChange={(e) => setPoSupplierId(e.target.value)}
                    className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground"
                  >
                    <option value="">Choose a supplier…</option>
                    {suppliers.filter((s) => s.active).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-[13px] font-medium text-foreground">Items</label>
                  {lines.map((line, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <select
                        value={line.inventoryItemId}
                        onChange={(e) => updateLine(i, { inventoryItemId: e.target.value })}
                        className="h-10 min-w-[160px] flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[16px] text-foreground"
                      >
                        <option value="">Item…</option>
                        {inventoryItems.map((it) => (
                          <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>
                        ))}
                      </select>
                      <input
                        value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })}
                        placeholder="Qty" className="h-10 w-20 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[16px] text-foreground"
                      />
                      <input
                        value={line.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value.replace(/[^0-9.]/g, '') })}
                        placeholder="₹/unit" className="h-10 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[16px] text-foreground"
                      />
                      <button onClick={() => removeLine(i)} className="grid h-10 w-10 place-items-center text-muted-foreground hover:text-destructive"><X size={15} /></button>
                    </div>
                  ))}
                  <button onClick={addLine} className="text-[12.5px] font-medium text-primary hover:underline">+ Add another item</button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Expected delivery (optional)" type="date" value={poExpected} onChange={(e) => setPoExpected(e.target.value)} />
                  <Input label="Notes (optional)" value={poNotes} onChange={(e) => setPoNotes(e.target.value)} />
                </div>

                {poError && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{poError}</p>}
                <Button onClick={createOrder} loading={savingPo}>Create purchase order</Button>
              </div>
            </Card>
          )}

          <ul className="mt-5 space-y-3">
            {orders.length === 0 && !creating && <p className="text-sm text-muted-foreground">No purchase orders yet.</p>}
            {orders.map((po) => {
              const supplier = one(po.suppliers)
              const badge = STATUS_BADGE[po.status]
              const total = po.purchase_order_items.reduce((s, it) => s + it.qty_ordered * (it.unit_cost ?? 0), 0)
              const isOpen = expanded === po.id
              const canReceive = po.status === 'ordered' || po.status === 'partially_received'
              return (
                <li key={po.id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
                  <button onClick={() => setExpanded(isOpen ? null : po.id)} className="flex w-full items-center justify-between gap-3 text-left">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
                        <Truck size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-foreground">{supplier?.name ?? 'Unknown supplier'}</p>
                        <p className="text-[12px] text-muted-foreground">
                          {formatDate(po.order_date + 'T12:00:00Z')} · {po.purchase_order_items.length} item{po.purchase_order_items.length === 1 ? '' : 's'}
                          {total > 0 && ` · ₹${total.toLocaleString('en-IN')}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                      {isOpen ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="overflow-x-auto">
                      <table className="w-full min-w-[420px] text-[13px]">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="pb-1.5 font-medium">Item</th>
                            <th className="pb-1.5 text-right font-medium">Ordered</th>
                            <th className="pb-1.5 text-right font-medium">Received</th>
                            {canReceive && <th className="pb-1.5 text-right font-medium">Receive now</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {po.purchase_order_items.map((it) => {
                            const ii = one(it.inventory_items)
                            const remaining = it.qty_ordered - it.qty_received
                            return (
                              <tr key={it.id}>
                                <td className="py-1.5 text-foreground">
                                  <Package size={12} className="mr-1 inline text-muted-foreground" />{ii?.name ?? '—'}
                                </td>
                                <td className="py-1.5 text-right text-muted-foreground">{it.qty_ordered} {ii?.unit}</td>
                                <td className="py-1.5 text-right text-muted-foreground">{it.qty_received} {ii?.unit}</td>
                                {canReceive && (
                                  <td className="py-1.5 text-right">
                                    {remaining > 0 ? (
                                      <input
                                        value={receiveQty[it.id] ?? ''}
                                        onChange={(e) => setReceiveQty((m) => ({ ...m, [it.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                                        placeholder="0"
                                        className="h-8 w-20 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-right text-[16px] text-foreground"
                                      />
                                    ) : (
                                      <span className="text-[12px] text-success">Complete</span>
                                    )}
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      </div>

                      {po.notes && <p className="mt-2 text-[12px] text-muted-foreground">Note: {po.notes}</p>}
                      {po.cancel_reason && <p className="mt-2 text-[12px] text-destructive">Cancelled: {po.cancel_reason}</p>}
                      {receiveError && <p className="mt-2 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{receiveError}</p>}

                      {canReceive && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" loading={receiving} onClick={() => confirmReceive(po)}>Confirm receipt</Button>
                          {isAdmin && po.status === 'ordered' && (
                            <Button size="sm" variant="secondary" onClick={() => cancelOrder(po)}>Cancel order</Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {orders.length < ordersCount && (
            <div className="mt-4 flex flex-col items-center gap-1.5">
              <button
                onClick={() => void loadMoreOrders()}
                disabled={loadingMoreOrders}
                className="min-h-10 rounded-[var(--radius)] border border-border-strong px-5 text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50"
              >
                {loadingMoreOrders ? 'Loading…' : `Load more (${orders.length} of ${ordersCount})`}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="mt-5">
          {isAdmin && (
            <Card>
              <CardHeader title="Add a supplier" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Input label="Name" value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="Local Dairy Co." />
                <Input label="Contact person (optional)" value={supContact} onChange={(e) => setSupContact(e.target.value)} />
                <Input label="Phone (optional)" value={supPhone} onChange={(e) => setSupPhone(e.target.value)} />
                <Input label="Email (optional)" value={supEmail} onChange={(e) => setSupEmail(e.target.value)} />
                <Input label="Notes (optional)" value={supNotes} onChange={(e) => setSupNotes(e.target.value)} className="sm:col-span-2" />
              </div>
              {supplierError && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{supplierError}</p>}
              <Button className="mt-4" loading={savingSupplier} onClick={createSupplier}>Add supplier</Button>
            </Card>
          )}

          <ul className="mt-5 space-y-3">
            {suppliers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suppliers yet.</p>
            ) : (
              suppliers.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-foreground">{s.name}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details'}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => toggleSupplier(s)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium ${
                        s.active ? 'border-success bg-success-subtle text-success' : 'border-border-strong bg-surface-subtle text-muted-foreground'
                      }`}
                    >
                      {s.active ? 'Active' : 'Inactive'}
                    </button>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
