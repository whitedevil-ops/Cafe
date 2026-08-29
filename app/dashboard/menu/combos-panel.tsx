'use client'

import { useMemo, useState } from 'react'
import { Package, Trash2, Download } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { downloadCombosExport, type ComboExportRow } from '@/lib/menu-workbook'
import { savedFileHint } from '@/lib/is-desktop'
import type { Combo, ComboSlot } from '@/lib/combos'
import type { MenuCategory, MenuItemRow } from './types'

export type VariantRow = { id: string; menu_item_id: string; name: string; price_delta: number }

// Numeric fields live as strings while editing, same as ItemDraft in
// menu-manager.tsx — an empty number input shouldn't collapse to 0.
type SlotDraft = {
  label: string
  kind: 'fixed' | 'choice'
  menu_item_id: string
  variant_id: string
  category_id: string
  qty: string
}
type ComboDraft = {
  id?: string
  name: string
  description: string
  price: string
  margin: string
  slots: SlotDraft[]
}

const emptySlot: SlotDraft = { label: '', kind: 'choice', menu_item_id: '', variant_id: '', category_id: '', qty: '1' }
const emptyCombo: ComboDraft = { name: '', description: '', price: '', margin: '', slots: [] }

const SELECT_CLS =
  'h-10 w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground'

// The modal is a real sequence — you can't price a bundle before you know
// what's in it — so the steps are numbered rather than just spaced apart.
function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-primary-subtle text-[11px] font-semibold text-primary">
        {n}
      </span>
      {title}
    </p>
  )
}

export default function CombosPanel({
  cafeId,
  cafeName,
  canManage,
  categories,
  items,
  variants,
  initialCombos,
  initialSlots,
}: {
  cafeId: string
  cafeName: string
  canManage: boolean
  categories: MenuCategory[]
  items: MenuItemRow[]
  variants: VariantRow[]
  initialCombos: Combo[]
  initialSlots: ComboSlot[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [combos, setCombos] = useState(initialCombos)
  const [slots, setSlots] = useState(initialSlots)
  const [draft, setDraft] = useState<ComboDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const liveItems = useMemo(() => items.filter((i) => !i.archived), [items])
  const itemById = useMemo(() => new Map(liveItems.map((i) => [i.id, i])), [liveItems])
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const variantsByItem = useMemo(() => {
    const m = new Map<string, VariantRow[]>()
    variants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [variants])

  function slotsOfCombo(comboId: string) {
    return slots.filter((s) => s.combo_id === comboId).sort((a, b) => a.sort - b.sort)
  }

  /** "Any Pizza × 1 · Cheese Garlic Bread · Any Mojito × 2" */
  function summarize(comboId: string) {
    const list = slotsOfCombo(comboId)
    if (list.length === 0) return 'No items yet'
    return list.map((s) => (s.qty > 1 ? `${s.label} × ${s.qty}` : s.label)).join(' · ')
  }

  /**
   * What the specific items in the draft would cost at menu price. Choice rows
   * are excluded and reported separately — "Any Pizza" costs whatever the guest
   * picks, so there's no single number for it.
   */
  function draftFixedValue(list: SlotDraft[]) {
    let total = 0
    let hasChoice = false
    for (const s of list) {
      if (s.kind !== 'fixed' || !s.menu_item_id) {
        if (s.kind === 'choice') hasChoice = true
        continue
      }
      const item = itemById.get(s.menu_item_id)
      if (!item) continue
      const delta = s.variant_id ? (variants.find((v) => v.id === s.variant_id)?.price_delta ?? 0) : 0
      total += (item.price + delta) * (Math.round(Number(s.qty)) || 1)
    }
    return { total, hasChoice }
  }

  function openNew() {
    setError(null)
    setDraft({ ...emptyCombo, slots: [{ ...emptySlot }] })
  }

  function openEdit(c: Combo) {
    setError(null)
    setDraft({
      id: c.id,
      name: c.name,
      description: c.description ?? '',
      price: String(c.price),
      margin: c.margin == null ? '' : String(c.margin),
      slots: slotsOfCombo(c.id).map((s) => ({
        label: s.label,
        kind: s.kind,
        menu_item_id: s.menu_item_id ?? '',
        variant_id: s.variant_id ?? '',
        category_id: s.category_id ?? '',
        qty: String(s.qty),
      })),
    })
  }

  function patchSlot(idx: number, patch: Partial<SlotDraft>) {
    if (!draft) return
    setDraft({ ...draft, slots: draft.slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)) })
  }

  async function save() {
    if (!draft) return
    const price = Math.round(Number(draft.price))
    // Blank margin is fine — it's the owner's own planning figure, not required
    // to sell the combo.
    const margin = draft.margin.trim() === '' ? null : Math.round(Number(draft.margin))
    if (!draft.name.trim()) return setError('Enter a combo name.')
    if (draft.slots.length === 0) return setError('Add at least one item to the combo.')
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid combo price.')
    if (margin != null && (!Number.isFinite(margin) || margin < 0)) return setError('Enter a valid margin.')
    if (margin != null && margin > price) return setError('Margin cannot be more than the combo price.')

    // Mirror the server-side checks in sync_combo_slots so a mistake surfaces
    // immediately instead of as a round-trip error.
    for (const s of draft.slots) {
      if (!s.label.trim()) return setError('Every row needs a label.')
      if (s.kind === 'fixed') {
        if (!s.menu_item_id) return setError(`Pick the item for "${s.label}".`)
        if ((variantsByItem.get(s.menu_item_id) ?? []).length > 0 && !s.variant_id) {
          return setError(`"${s.label}" has sizes — pick one.`)
        }
      } else if (!s.category_id) {
        return setError(`Pick the category guests choose from for "${s.label}".`)
      }
    }

    const payload = draft.slots.map((s) => ({
      label: s.label.trim(),
      kind: s.kind,
      qty: Math.max(1, Math.round(Number(s.qty)) || 1),
      menu_item_id: s.kind === 'fixed' ? s.menu_item_id : null,
      variant_id: s.kind === 'fixed' ? s.variant_id || null : null,
      category_id: s.kind === 'choice' ? s.category_id : null,
    }))

    setBusy(true)
    setError(null)
    const { data, error: err } = draft.id
      ? await supabase.rpc('update_combo', {
          p_combo_id: draft.id, p_name: draft.name.trim(), p_price: price,
          p_slots: payload, p_description: draft.description.trim() || null, p_margin: margin,
        })
      : await supabase.rpc('create_combo', {
          p_cafe_id: cafeId, p_name: draft.name.trim(), p_price: price,
          p_slots: payload, p_description: draft.description.trim() || null, p_margin: margin,
        })
    setBusy(false)
    if (err) return setError(err.message)

    // Slots are replaced wholesale server-side, so re-read them rather than
    // reconstructing the new ids locally.
    const saved = data as Combo
    const { data: fresh } = await supabase.from('combo_slots').select('*').eq('combo_id', saved.id).order('sort')
    setSlots((list) => [...list.filter((s) => s.combo_id !== saved.id), ...((fresh ?? []) as ComboSlot[])])
    setCombos((list) => (draft.id ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved]))
    setDraft(null)
    toast(draft.id ? 'Combo updated.' : `Combo "${saved.name}" created.`)
  }

  function exportToExcel() {
    const rows: ComboExportRow[] = []
    for (const c of combos) {
      for (const s of slotsOfCombo(c.id)) {
        const item = s.menu_item_id ? itemById.get(s.menu_item_id) : null
        const variant = s.variant_id ? variants.find((v) => v.id === s.variant_id) : null
        rows.push({
          combo: c.name,
          comboPrice: c.price,
          comboMargin: c.margin ?? null,
          active: c.active,
          label: s.label,
          kind: s.kind,
          target:
            s.kind === 'fixed'
              ? (item?.name ?? '(item removed)')
              : (catById.get(s.category_id ?? '')?.name ?? '(category removed)'),
          size: variant?.name ?? null,
          qty: s.qty,
          unitPrice: s.kind === 'fixed' && item ? item.price + (variant?.price_delta ?? 0) : null,
        })
      }
    }
    if (rows.length === 0) return toast('Nothing to export yet — create a combo first.', 'error')
    toast(savedFileHint(downloadCombosExport(cafeName, rows)))
  }

  async function toggleActive(c: Combo) {
    setCombos((list) => list.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)))
    const { error: err } = await supabase.rpc('set_combo_active', { p_combo_id: c.id, p_active: !c.active })
    if (err) {
      setCombos((list) => list.map((x) => (x.id === c.id ? { ...x, active: c.active } : x)))
      toast(err.message, 'error')
    }
  }

  async function remove(c: Combo) {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      description: 'This cannot be undone. Past orders that included it keep their own record.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    const { error: err } = await supabase.rpc('delete_combo', { p_combo_id: c.id })
    if (err) return toast(err.message, 'error')
    setCombos((list) => list.filter((x) => x.id !== c.id))
    setSlots((list) => list.filter((s) => s.combo_id !== c.id))
    toast(`"${c.name}" deleted.`)
  }

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Combos</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Bundle deals at a set price — &ldquo;Any Pizza + Any Mojito ₹199&rdquo;. Guests pick within the
            choices you allow, and the kitchen still gets each item as its own ticket line.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {combos.length > 0 && (
            <Button variant="secondary" size="sm" onClick={exportToExcel}>
              <Download size={14} /> Export
            </Button>
          )}
          {canManage && <Button size="sm" onClick={openNew}>Add combo</Button>}
        </div>
      </div>

      {combos.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">No combos yet.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {combos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface-subtle p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
                  <Package size={16} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-foreground">
                    {c.name} <span className="text-muted-foreground">· ₹{c.price}</span>
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">{summarize(c.id)}</p>
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => openEdit(c)} className="min-h-9 px-2 text-[13px] font-medium text-primary hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(c)}
                    className={`min-h-9 rounded-full border px-2.5 text-[12px] font-medium ${
                      c.active ? 'border-success text-success' : 'border-border-strong text-muted-foreground'
                    }`}
                  >
                    {c.active ? 'Live' : 'Off'}
                  </button>
                  <button
                    onClick={() => remove(c)}
                    aria-label={`Delete ${c.name}`}
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
          <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <h2 className="text-[15px] font-semibold text-foreground">{draft.id ? 'Edit combo' : 'New combo'}</h2>

            <div className="mt-4">
              <StepHeading n={1} title="Name it" />
              <div className="mt-3 space-y-3">
                <Input label="Combo name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Meal for Two" />
                <Input label="Description (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Perfect for sharing" />
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <StepHeading n={2} title="Pick what's in it" />
                <button
                  onClick={() => setDraft({ ...draft, slots: [...draft.slots, { ...emptySlot }] })}
                  className="text-[13px] font-medium text-primary hover:underline"
                >
                  + Add item
                </button>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Each row is either a specific item, or a choice the guest makes from a category.
              </p>

              <div className="mt-3 space-y-3">
                {draft.slots.map((s, idx) => {
                  const slotVariants = s.menu_item_id ? (variantsByItem.get(s.menu_item_id) ?? []) : []
                  return (
                    <div key={idx} className="rounded-[var(--radius)] border border-border-strong p-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={s.label}
                          onChange={(e) => patchSlot(idx, { label: e.target.value })}
                          placeholder="Label — e.g. Any Pizza"
                          className="h-10 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
                        />
                        <input
                          type="number" min={1} value={s.qty}
                          onChange={(e) => patchSlot(idx, { qty: e.target.value })}
                          aria-label="Quantity"
                          className="h-10 w-16 shrink-0 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground"
                        />
                        <button
                          onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== idx) })}
                          aria-label="Remove row"
                          className="grid h-10 w-8 shrink-0 place-items-center text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          value={s.kind}
                          onChange={(e) => patchSlot(idx, { kind: e.target.value as SlotDraft['kind'], menu_item_id: '', variant_id: '', category_id: '' })}
                          className={`${SELECT_CLS} max-w-[150px]`}
                        >
                          <option value="choice">Guest chooses</option>
                          <option value="fixed">Specific item</option>
                        </select>

                        {s.kind === 'choice' ? (
                          <select
                            value={s.category_id}
                            onChange={(e) => patchSlot(idx, { category_id: e.target.value })}
                            className={`${SELECT_CLS} flex-1`}
                          >
                            <option value="">…from which category?</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        ) : (
                          <>
                            <SearchableSelect
                              value={s.menu_item_id}
                              onChange={(v) => patchSlot(idx, { menu_item_id: v, variant_id: '' })}
                              options={liveItems.map((i) => ({ value: i.id, label: i.name }))}
                              placeholder="…which item?"
                              searchPlaceholder="Search menu items…"
                              className="flex-1"
                            />
                            {slotVariants.length > 0 && (
                              <select
                                value={s.variant_id}
                                onChange={(e) => patchSlot(idx, { variant_id: e.target.value })}
                                className={`${SELECT_CLS} max-w-[130px]`}
                              >
                                <option value="">Size…</option>
                                {slotVariants.map((v) => (
                                  <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                              </select>
                            )}
                          </>
                        )}
                      </div>

                      {s.kind === 'choice' && s.category_id && catById.get(s.category_id) && (
                        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                          Guest picks {s.qty || 1} from {catById.get(s.category_id)!.name}
                        </p>
                      )}
                      {s.kind === 'fixed' && s.menu_item_id && itemById.get(s.menu_item_id) && (
                        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                          Always includes {itemById.get(s.menu_item_id)!.name} · ₹{itemById.get(s.menu_item_id)!.price}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <StepHeading n={3} title="Price it" />
              <div className="mt-3 flex flex-wrap gap-3">
                <Input
                  label="Combo price (₹)" type="number" min={0} value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  hint="What the guest pays for the whole bundle."
                  className="w-[150px]"
                />
                <Input
                  label="Your margin (₹)" type="number" min={0} value={draft.margin}
                  onChange={(e) => setDraft({ ...draft, margin: e.target.value })}
                  hint="Optional. Only you see this — never shown to guests."
                  className="w-[150px]"
                />
              </div>
              {(() => {
                const { total, hasChoice } = draftFixedValue(draft.slots)
                const price = Math.round(Number(draft.price))
                if (total === 0) return null
                const saving = Number.isFinite(price) && price > 0 ? Math.max(0, total - price) : null
                return (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Specific items add up to <span className="font-medium text-foreground">₹{total}</span> at menu price
                    {hasChoice && ', plus whatever the guest chooses'}
                    {saving != null && !hasChoice && saving > 0 && <> — guests save ₹{saving}</>}.
                  </p>
                )
              })()}
            </div>

            {error && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

            <div className="mt-5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDraft(null)}>Cancel</Button>
              <Button className="flex-1" loading={busy} onClick={save}>Save combo</Button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
