'use client'

import { useMemo, useState } from 'react'
import { Percent, Trash2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { MenuItemRow } from './types'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function daysLabel(days: number[]): string {
  if (days.length === 7) return 'Every day'
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(', ')
}

type OfferDraft = { itemId: string; price: string; days: number[] }
const emptyDraft: OfferDraft = { itemId: '', price: '', days: [] }

// A dedicated section rather than a field buried in each item's edit drawer —
// so an owner can see every discount running across the whole menu at a
// glance, and create or remove one without opening the item itself. Mirrors
// CombosPanel's shape (list + add/edit modal), one level down in complexity
// since an offer is two plain columns on menu_items (see
// supabase/migrations/0154_todays_offer_pricing.sql), not its own table —
// "delete" here just means clearing offer_price/offer_days back to null.
export default function OffersPanel({
  canManage,
  items,
  onItemsChange,
}: {
  canManage: boolean
  items: MenuItemRow[]
  /** Keeps MenuManager's own item list in sync after a save/delete here —
   *  offers live on the same row the rest of the item editor reads. */
  onItemsChange: (items: MenuItemRow[]) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [draft, setDraft] = useState<OfferDraft | null>(null)
  const [itemSearch, setItemSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const liveItems = useMemo(() => items.filter((i) => !i.archived), [items])
  const offered = useMemo(() => liveItems.filter((i) => i.offer_price != null), [liveItems])
  const itemById = useMemo(() => new Map(liveItems.map((i) => [i.id, i])), [liveItems])
  // An offer already in the list is edited through its own row, not picked
  // again here — same "which item?" question either way, so this is the one
  // place that tells the modal whether the item choice is locked.
  const isEditingExisting = draft ? offered.some((i) => i.id === draft.itemId) : false

  function openNew() {
    setError(null)
    setItemSearch('')
    setDraft({ ...emptyDraft })
  }

  function openEdit(item: MenuItemRow) {
    setError(null)
    setItemSearch('')
    setDraft({ itemId: item.id, price: String(item.offer_price), days: item.offer_days ?? [] })
  }

  async function save() {
    if (!draft) return
    const item = itemById.get(draft.itemId)
    if (!item) return setError('Pick an item.')
    const price = Math.round(Number(draft.price))
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid offer price in rupees.')
    if (price >= item.price) return setError(`Offer price must be less than ${item.name}'s selling price (₹${item.price}).`)
    if (draft.days.length === 0) return setError('Pick at least one day.')

    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('menu_items')
      .update({ offer_price: price, offer_days: draft.days })
      .eq('id', item.id)
      .select()
      .single()
    setBusy(false)
    if (err) return setError(err.message)

    onItemsChange(items.map((i) => (i.id === item.id ? (data as MenuItemRow) : i)))
    setDraft(null)
    toast(`Offer saved for "${item.name}".`)
  }

  async function remove(item: MenuItemRow) {
    const ok = await confirm({
      title: `Remove the offer on "${item.name}"?`,
      description: 'It goes back to its regular selling price everywhere — QR menu, POS, and checkout suggestions.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    const { data, error: err } = await supabase
      .from('menu_items')
      .update({ offer_price: null, offer_days: null })
      .eq('id', item.id)
      .select()
      .single()
    if (err) return toast(err.message, 'error')
    onItemsChange(items.map((i) => (i.id === item.id ? (data as MenuItemRow) : i)))
    toast(`Offer removed from "${item.name}".`)
  }

  // "Add offer" only lists items that don't already have one — editing an
  // existing offer happens through its own row's Edit button instead.
  const pickableItems = useMemo(
    () => liveItems.filter((i) => i.offer_price == null || i.id === draft?.itemId),
    [liveItems, draft],
  )

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Today&apos;s Offers</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            A lower price on specific items, on specific days of the week. Applies everywhere an
            order can be placed — QR menu and POS — and is available on every plan.
          </p>
        </div>
        {canManage && <Button size="sm" onClick={openNew}>Add offer</Button>}
      </div>

      {offered.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No offers running right now.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {offered.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface-subtle p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-special-subtle text-special">
                  <Percent size={16} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-foreground">
                    {item.name} <span className="text-muted-foreground">· ₹{item.offer_price} instead of ₹{item.price}</span>
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">{daysLabel(item.offer_days ?? [])}</p>
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => openEdit(item)} className="min-h-9 px-2 text-[13px] font-medium text-primary hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => remove(item)}
                    aria-label={`Remove offer from ${item.name}`}
                    className="grid h-9 w-9 place-items-center text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" role="presentation">
          {/* Rounding + clipping on the outer flex container, scrolling on the
              inner one — a border-radius doesn't clip its own scrollbar. */}
          <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <h2 className="text-[15px] font-semibold text-foreground">{isEditingExisting ? 'Edit offer' : 'New offer'}</h2>

            <div className="mt-4 space-y-3">
              <div>
                <p className="mb-1.5 text-[12.5px] text-muted-foreground">Item</p>
                {isEditingExisting ? (
                  // Which item an existing offer applies to isn't editable —
                  // change the price/days here, or remove it and add a new one.
                  <p className="rounded-[var(--radius)] border border-border-strong bg-surface-subtle px-2.5 py-2 text-[13px] text-foreground">
                    {itemById.get(draft.itemId)?.name} <span className="text-muted-foreground">· ₹{itemById.get(draft.itemId)?.price}</span>
                  </p>
                ) : draft.itemId ? (
                  <div className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-primary bg-primary-subtle px-2.5 py-2 text-[13px]">
                    <span className="text-foreground">
                      {itemById.get(draft.itemId)?.name} <span className="text-muted-foreground">· ₹{itemById.get(draft.itemId)?.price}</span>
                    </span>
                    <button type="button" onClick={() => setDraft({ ...draft, itemId: '' })} className="shrink-0 font-medium text-primary hover:underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Search items…"
                      autoFocus
                      className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground"
                    />
                    {itemSearch.trim() && (
                      <ul className="mt-1.5 max-h-48 overflow-y-auto rounded-[var(--radius)] border border-border bg-surface">
                        {pickableItems
                          .filter((i) => i.name.toLowerCase().includes(itemSearch.trim().toLowerCase()))
                          .slice(0, 20)
                          .map((i) => (
                            <li key={i.id}>
                              <button
                                type="button"
                                onClick={() => { setDraft({ ...draft, itemId: i.id }); setItemSearch('') }}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-foreground hover:bg-surface-subtle"
                              >
                                <span>{i.name}</span><span className="text-muted-foreground">₹{i.price}</span>
                              </button>
                            </li>
                          ))}
                        {pickableItems.filter((i) => i.name.toLowerCase().includes(itemSearch.trim().toLowerCase())).length === 0 && (
                          <li className="px-3 py-2 text-[13px] text-muted-foreground">No items match &ldquo;{itemSearch.trim()}&rdquo;.</li>
                        )}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <Input
                label="Offer price (₹)"
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                hint="What a guest pays instead of the selling price, on the days below."
              />

              <div>
                <p className="mb-1.5 text-[12.5px] text-muted-foreground">Days</p>
                <div className="flex gap-1">
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          days: draft.days.includes(i) ? draft.days.filter((d) => d !== i) : [...draft.days, i],
                        })
                      }
                      className={`flex-1 rounded-[var(--radius-sm)] py-1.5 text-[12px] font-medium transition-colors ${
                        draft.days.includes(i) ? 'bg-primary-subtle text-primary' : 'bg-surface-subtle text-muted-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDraft(null)}>Cancel</Button>
              <Button className="flex-1" loading={busy} onClick={save}>Save offer</Button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
