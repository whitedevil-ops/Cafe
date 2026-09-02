'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { uploadMenuImage } from '@/lib/image-upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import BulkImportPanel from './bulk-import-panel'
import { optionFromDeltas, optionToDeltas } from '@/lib/menu-options'
import CombosPanel, { type VariantRow } from './combos-panel'
import OffersPanel from './offers-panel'
import { suggestCategoryPairings } from '@/lib/recommend'
import type { MenuCategory, MenuItemRow } from './types'
import type { Combo, ComboSlot } from '@/lib/combos'

// PostgREST's PGRST116 ("JSON object requested, multiple (or no) rows
// returned") is what .update(...).select().single() throws when the update's
// WHERE clause matched zero rows — almost always because row-level security
// silently rejected the write (an expired/stale session, or a role that
// isn't allowed to edit the menu), not because the item stopped existing.
// The raw message is meaningless to a café owner; this turns it into
// something actionable instead of "Cannot coerce the result to a single
// JSON object."
function friendlyWriteError(error: { code?: string; message: string } | null): string | null {
  if (!error) return null
  if (error.code === 'PGRST116') {
    return "Couldn't save — this can happen if your sign-in expired or you don't have permission to edit the menu. Try refreshing the page and signing in again."
  }
  return error.message
}

// Each option carries the price a guest actually pays and the margin the owner
// actually keeps — the same two numbers the menu sheet asks for. The database
// stores them as deltas from the base item (price_delta / cost_delta), so the
// conversion happens on save and load rather than in the owner's head.
type VariantDraft = { id?: string; name: string; price: string; margin: string }
type AddonDraft = { id?: string; name: string; price: string }

type ItemDraft = {
  id?: string
  name: string
  description: string
  category_id: string | null
  price: string
  /**
   * The ₹ kept on one, not what it costs to make. The database stores cost,
   * so this converts on load and save — the same swap the menu sheet and the
   * size rows already made, so an owner is never asked both questions.
   */
  margin: string
  cost_source: 'manual' | 'recipe'
  image_url: string | null
  available: boolean
  is_veg: boolean | null
  is_bestseller: boolean
  /**
   * The item's own cost as the database computes it — the recipe total when
   * cost_source is 'recipe', otherwise the manual cost. Options are stored as a
   * difference from this, so converting a typed margin needs the real base;
   * reading menu_items.cost would be wrong for a recipe-costed item.
   * Null for a brand-new item, which has no stored cost yet.
   */
  effectiveCost: number | null
  variants: VariantDraft[]
  addons: AddonDraft[]
  // Cross-sell suggestions (other menu item ids) shown when this item is added.
  pairings: string[]
}

const emptyDraft: ItemDraft = {
  name: '',
  description: '',
  category_id: null,
  price: '',
  margin: '',
  cost_source: 'manual',
  image_url: null,
  available: true,
  is_veg: null,
  is_bestseller: false,
  effectiveCost: null,
  variants: [],
  addons: [],
  pairings: [],
}

export default function MenuManager({
  cafeId,
  cafeName,
  role,
  initialCategories,
  initialItems,
  initialCombos,
  initialComboSlots,
  variants,
  stations,
  inventoryAllowed,
}: {
  cafeId: string
  cafeName: string
  role: string
  initialCategories: MenuCategory[]
  initialItems: MenuItemRow[]
  initialCombos: Combo[]
  initialComboSlots: ComboSlot[]
  variants: VariantRow[]
  stations: { id: string; name: string }[]
  /** Plan entitlement — see page.tsx. Recipe-costed margin (menu_item_effective_cost)
   *  is inventory-tier data, same as the Recipes page it's computed from. */
  inventoryAllowed: boolean
}) {
  // Estimated cost + contribution are owner/manager information (spec §6).
  const canSeeCost = role === 'owner' || role === 'manager'
  const [pairSearch, setPairSearch] = useState('')
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()
  const [categories, setCategories] = useState(initialCategories)
  const [items, setItems] = useState(initialItems)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'sold_out'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [draft, setDraft] = useState<ItemDraft | null>(null)
  const [manageCats, setManageCats] = useState(false)
  const [manageCombos, setManageCombos] = useState(false)
  const [manageOffers, setManageOffers] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Category → category cross-sell rules (e.g. Pizza pairs with Dips, Drinks).
  // Cold-start: covers every item in a category without configuring each one.
  const [categoryPairs, setCategoryPairs] = useState<Record<string, string[]>>({})
  const [pairingCat, setPairingCat] = useState<string | null>(null)
  const [savingPairs, setSavingPairs] = useState(false)
  const [refreshingStats, setRefreshingStats] = useState(false)

  async function loadCategoryPairs() {
    const { data } = await supabase.from('category_pairings').select('category_id, suggested_category_id').eq('cafe_id', cafeId)
    const m: Record<string, string[]> = {}
    for (const row of data ?? []) m[row.category_id] = [...(m[row.category_id] ?? []), row.suggested_category_id]
    setCategoryPairs(m)
  }
  useEffect(() => {
    // loadCategoryPairs is async and only calls setState after its own network
    // round-trip completes — not a synchronous render-phase update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCategoryPairs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleCategoryPair(catId: string, otherId: string) {
    const current = categoryPairs[catId] ?? []
    const next = current.includes(otherId) ? current.filter((id) => id !== otherId) : [...current, otherId]
    setCategoryPairs((m) => ({ ...m, [catId]: next }))
    setSavingPairs(true)
    const { error: err } = await supabase.rpc('set_category_pairings', { p_cafe_id: cafeId, p_category_id: catId, p_suggested: next })
    setSavingPairs(false)
    if (err) toast(err.message, 'error')
  }

  async function refreshRecommendationStats() {
    setRefreshingStats(true)
    const { error: err } = await supabase.rpc('refresh_order_pairings', { p_cafe_id: cafeId })
    setRefreshingStats(false)
    if (err) return toast(err.message, 'error')
    toast('Recommendation stats refreshed from recent orders.')
  }

  // Fills in sensible defaults from category names (Burgers → drinks, Coffee →
  // desserts, ...) — the same heuristic bulk-import already offers, just
  // runnable any time for a menu that's already set up. Only ADDS to what's
  // there; never removes a pairing set manually, so it's always safe to run.
  async function autoSuggestPairings() {
    const grouped: Record<string, Set<string>> = {}
    for (const catId of Object.keys(categoryPairs)) grouped[catId] = new Set(categoryPairs[catId])
    for (const s of suggestCategoryPairings(categories)) {
      if (!grouped[s.categoryId]) grouped[s.categoryId] = new Set(categoryPairs[s.categoryId] ?? [])
      grouped[s.categoryId].add(s.suggestedCategoryId)
    }
    const toUpdate = Object.keys(grouped).filter((catId) => {
      const existing = categoryPairs[catId] ?? []
      return grouped[catId].size !== existing.length || [...grouped[catId]].some((id) => !existing.includes(id))
    })
    if (toUpdate.length === 0) {
      toast('No new pairings to suggest for these category names.')
      return
    }
    setSavingPairs(true)
    for (const catId of toUpdate) {
      await supabase.rpc('set_category_pairings', { p_cafe_id: cafeId, p_category_id: catId, p_suggested: [...grouped[catId]] })
    }
    setSavingPairs(false)
    await loadCategoryPairs()
    toast(`Added pairings for ${toUpdate.length} categor${toUpdate.length === 1 ? 'y' : 'ies'} — review and adjust below.`)
  }

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorised'

  // Bulk import can create many categories/items at once — a full refetch is
  // simpler and safer here than trying to merge an unbounded batch into state.
  async function refetchMenu() {
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('menu_categories').select('*').eq('cafe_id', cafeId).order('sort'),
      supabase.from('menu_items').select('*').eq('cafe_id', cafeId).order('sort'),
    ])
    if (cats) setCategories(cats as MenuCategory[])
    if (its) setItems(its as MenuItemRow[])
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => !i.archived)
      .filter((i) => (categoryFilter === 'all' ? true : i.category_id === categoryFilter))
      .filter((i) =>
        availabilityFilter === 'all'
          ? true
          : availabilityFilter === 'available'
            ? i.available
            : !i.available,
      )
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
  }, [items, search, categoryFilter, availabilityFilter])

  // ── Category CRUD ──────────────────────────────────────────────────────────
  // Case/whitespace-insensitive so "COFFEE" doesn't sit unnoticed next to an
  // existing "Coffee" — found live: a real café had accumulated near-duplicate
  // categories ("Hot Coffee" next to "COFFEE", "Tea & Beverages" next to
  // "TEA & HOT BEVERAGES") from imports at different times, with nothing
  // ever flagging it. Warns rather than blocks — a café might genuinely want
  // two similarly-named categories, this just makes sure that's on purpose.
  function normalizedCatName(s: string) {
    return s.trim().toLowerCase().replace(/\s+/g, ' ')
  }

  async function addCategory() {
    const name = newCat.trim()
    if (!name) return
    const norm = normalizedCatName(name)
    const dupe = categories.find((c) => normalizedCatName(c.name) === norm)
    if (dupe) {
      const ok = await confirm({
        title: `"${dupe.name}" already exists`,
        description: `A category with the same name (just different capitalisation/spacing) is already on your menu. Add "${name}" as a separate category anyway?`,
        confirmLabel: 'Add anyway',
      })
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    const sort = categories.length
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ cafe_id: cafeId, name, sort })
      .select()
      .single()
    setBusy(false)
    if (error) return setError(friendlyWriteError(error))
    setCategories((c) => [...c, data as MenuCategory])
    setNewCat('')
  }

  async function deleteCategory(id: string) {
    const name = categories.find((c) => c.id === id)?.name ?? 'this category'
    const ok = await confirm({
      title: `Delete "${name}"?`,
      description: 'Items in it become uncategorised. This can\'t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase.from('menu_categories').delete().eq('id', id)
    if (error) return setError(error.message)
    setCategories((c) => c.filter((x) => x.id !== id))
    setItems((list) => list.map((i) => (i.category_id === id ? { ...i, category_id: null } : i)))
    if (categoryFilter === id) setCategoryFilter('all')
  }

  // Routes every item in this category to a kitchen printer bound to that
  // station (kot_printers.station_id). Without this, a station-bound printer
  // has no category ever mapped to it and prints nothing — this is the one
  // piece of KOT station routing that only exists here, not in Settings.
  async function updateCategoryStation(id: string, stationId: string | null) {
    const previous = categories.find((c) => c.id === id)?.station_id ?? null
    setCategories((c) => c.map((x) => (x.id === id ? { ...x, station_id: stationId } : x)))
    const { error } = await supabase.from('menu_categories').update({ station_id: stationId }).eq('id', id)
    if (error) {
      setError(error.message)
      setCategories((c) => c.map((x) => (x.id === id ? { ...x, station_id: previous } : x)))
    }
  }

  // ── Item CRUD ──────────────────────────────────────────────────────────────
  async function saveItem() {
    if (!draft) return
    const name = draft.name.trim()
    const price = Math.round(Number(draft.price))
    if (!name) return setError('Item name is required.')
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price in rupees.')
    // Refuse rather than clamp: silently storing a cost of 0 would quietly
    // report this item as pure profit in every report.
    if (canSeeCost && draft.cost_source === 'manual' && draft.margin.trim() !== '') {
      const m = Math.round(Number(draft.margin))
      if (!Number.isFinite(m) || m < 0) return setError('Enter a valid margin in rupees.')
      if (m > price) return setError("Margin can't be more than the selling price.")
    }
    for (const v of draft.variants) {
      if (!v.name.trim() || v.margin.trim() === '') continue
      const vp = Math.round(Number(v.price) || 0)
      const vm = Math.round(Number(v.margin))
      if (!Number.isFinite(vm) || vm < 0 || vm > vp) {
        return setError(`"${v.name.trim()}" — margin can't be more than its price.`)
      }
    }
    setBusy(true)
    setError(null)
    // Only owner/manager may set cost; for others omit the fields entirely so
    // an update can never blank an existing cost.
    // Margin back to the cost the column actually holds. Clamped to the price
    // so a slip can't store a negative cost.
    const marginToCost = () => {
      const m = Math.max(0, Math.round(Number(draft.margin) || 0))
      return Math.max(0, price - m)
    }
    const costPatch = canSeeCost
      ? {
          cost_source: draft.cost_source,
          cost:
            draft.cost_source === 'manual' && draft.margin.trim() !== ''
              ? marginToCost()
              : draft.cost_source === 'manual'
                ? null
                : undefined, // 'recipe' → leave the stored manual cost untouched
        }
      : {}

    const payload = {
      cafe_id: cafeId,
      category_id: draft.category_id,
      name,
      description: draft.description.trim() || null,
      price,
      image_url: draft.image_url,
      available: draft.available,
      is_veg: draft.is_veg,
      is_bestseller: draft.is_bestseller,
      ...costPatch,
    }

    let itemId = draft.id
    if (draft.id) {
      const { data, error } = await supabase
        .from('menu_items')
        .update(payload)
        .eq('id', draft.id)
        .select()
        .single()
      if (error) {
        setBusy(false)
        return setError(friendlyWriteError(error))
      }
      setItems((list) => list.map((i) => (i.id === draft.id ? (data as MenuItemRow) : i)))
    } else {
      const sort = items.length
      const { data, error } = await supabase
        .from('menu_items')
        .insert({ ...payload, sort })
        .select()
        .single()
      if (error) {
        setBusy(false)
        return setError(friendlyWriteError(error))
      }
      itemId = (data as MenuItemRow).id
      setItems((list) => [...list, data as MenuItemRow])
    }

    // Sync variants + add-ons: simplest correct approach at this scale is
    // replace-all (delete then insert the current set).
    const err = await syncModifiers(itemId!, draft)

    // Smart add-ons (cross-sell) — owner/manager only, saved through the
    // validated RPC (replace-all). Failure here never blocks the item save.
    if (canSeeCost) {
      await supabase.rpc('set_item_pairings', {
        p_cafe_id: cafeId,
        p_item_id: itemId!,
        p_suggestions: draft.pairings.map((id, i) => ({ suggested_item_id: id, sort: i, pinned: true })),
      })
    }

    setBusy(false)
    if (err) return setError(err)
    toast(draft.id ? 'Item updated.' : 'Item added to menu.')
    setDraft(null)
  }

  async function syncModifiers(itemId: string, d: ItemDraft): Promise<string | null> {
    await supabase.from('menu_item_variants').delete().eq('menu_item_id', itemId)
    await supabase.from('menu_item_addons').delete().eq('menu_item_id', itemId)

    // Absolute price/margin back to the deltas the database stores. Mirrors the
    // bulk importer exactly: an option with no margin of its own costs the same
    // as the base item (delta 0), and a blank base cost counts as 0 so an
    // option's margin still lands even when the item tracks no cost itself.
    //
    // A recipe-costed item's base is the recipe total, which the Cost field
    // doesn't show — hence effectiveCost rather than d.cost.
    const basePrice = Math.round(Number(d.price) || 0)
    const baseCost =
      d.cost_source === 'recipe'
        ? (d.effectiveCost ?? 0)
        : d.margin.trim() === ''
          ? 0
          : Math.max(0, basePrice - Math.round(Number(d.margin) || 0))
    const variants = d.variants
      .filter((v) => v.name.trim())
      .map((v, i) => ({
        menu_item_id: itemId,
        name: v.name.trim(),
        ...optionToDeltas(basePrice, baseCost, {
          price: Math.round(Number(v.price) || 0),
          margin: v.margin.trim() === '' ? null : Math.round(Number(v.margin) || 0),
        }),
        sort: i,
      }))
    const addons = d.addons
      .filter((a) => a.name.trim())
      .map((a, i) => ({ menu_item_id: itemId, name: a.name.trim(), price: Math.max(0, Math.round(Number(a.price) || 0)), sort: i }))

    if (variants.length) {
      const { error } = await supabase.from('menu_item_variants').insert(variants)
      if (error) return error.message
    }
    if (addons.length) {
      const { error } = await supabase.from('menu_item_addons').insert(addons)
      if (error) return error.message
    }
    return null
  }

  async function openEdit(item: MenuItemRow) {
    setDraft({
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      category_id: item.category_id,
      price: String(item.price),
      margin: item.cost != null ? String(item.price - item.cost) : '',
      cost_source: item.cost_source ?? 'manual',
      image_url: item.image_url,
      available: item.available,
      is_veg: item.is_veg,
      is_bestseller: item.is_bestseller,
      pairings: [],
      effectiveCost: null,
      variants: [],
      addons: [],
    })
    const [{ data: vs }, { data: as }, { data: prs }, { data: baseCost }] = await Promise.all([
      supabase.from('menu_item_variants').select('id, name, price_delta, cost_delta').eq('menu_item_id', item.id).order('sort'),
      supabase.from('menu_item_addons').select('id, name, price').eq('menu_item_id', item.id).order('sort'),
      supabase.from('menu_pairings').select('suggested_item_id, sort').eq('item_id', item.id).order('sort'),
      // What the database itself considers this item to cost, recipe included.
      // Recipe-derived cost is inventory-tier data (same entitlement the
      // Recipes page itself requires) — the RPC only checks cafe membership,
      // not plan, so the gate has to happen here instead of skipping the call
      // entirely when the plan doesn't include it.
      inventoryAllowed
        ? supabase.rpc('menu_item_effective_cost', { p_menu_item_id: item.id })
        : Promise.resolve({ data: null }),
    ])
    // Recipe-costed items price their options against the recipe total; manual
    // ones against the Cost field, which may legitimately be blank.
    const base = item.cost_source === 'recipe' ? (typeof baseCost === 'number' ? baseCost : 0) : item.cost
    setDraft((d) =>
      d && d.id === item.id
        ? {
            ...d,
            effectiveCost: typeof baseCost === 'number' ? baseCost : null,
            // Deltas back to the two numbers an owner recognises.
            variants: (vs ?? []).map((v) => {
              const { price, margin } = optionFromDeltas(item.price, base, { price_delta: v.price_delta, cost_delta: v.cost_delta ?? 0 })
              return { id: v.id, name: v.name, price: String(price), margin: margin == null ? '' : String(margin) }
            }),
            addons: (as ?? []).map((a) => ({ id: a.id, name: a.name, price: String(a.price) })),
            pairings: (prs ?? []).map((p) => p.suggested_item_id as string),
          }
        : d,
    )
  }

  async function onPickImage(file: File | undefined) {
    if (!file || !draft) return
    setUploading(true)
    setError(null)
    const result = await uploadMenuImage(cafeId, file)
    setUploading(false)
    if ('error' in result) return setError(result.error)
    setDraft((d) => (d ? { ...d, image_url: result.url } : d))
  }

  async function toggleAvailable(item: MenuItemRow) {
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, available: !i.available } : i)))
    const { error } = await supabase
      .rpc('set_menu_item_availability', { p_item_id: item.id, p_available: !item.available })
    if (error) {
      setError(error.message)
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, available: item.available } : i)))
    }
  }

  async function deleteItem(item: MenuItemRow) {
    const ok = await confirm({
      title: `Delete "${item.name}"?`,
      description: 'It will disappear from the QR menu and menu manager immediately. This can\'t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase.from('menu_items').delete().eq('id', item.id)
    if (error) return setError(error.message)
    setItems((list) => list.filter((i) => i.id !== item.id))
    toast(`"${item.name}" deleted.`)
  }

  // ── Bulk select: mark many items sold out/available or delete them at once ─
  async function bulkSetAvailable(ids: string[], available: boolean) {
    setItems((list) => list.map((i) => (ids.includes(i.id) ? { ...i, available } : i)))
    const results = await Promise.all(
      ids.map((id) => supabase.rpc('set_menu_item_availability', { p_item_id: id, p_available: available })),
    )
    const failed = results.filter((r) => r.error)
    if (failed.length) setError(failed[0].error!.message)
    setSelectedIds(new Set())
    toast(`${ids.length - failed.length} item${ids.length - failed.length === 1 ? '' : 's'} marked ${available ? 'available' : 'sold out'}.`)
  }

  async function bulkDelete(ids: string[]) {
    const ok = await confirm({
      title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`,
      description: 'They will disappear from the QR menu and menu manager immediately. This can\'t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase.from('menu_items').delete().in('id', ids)
    if (error) return setError(error.message)
    setItems((list) => list.filter((i) => !ids.includes(i.id)))
    setSelectedIds(new Set())
    toast(`${ids.length} item${ids.length === 1 ? '' : 's'} deleted.`)
  }

  function toggleSelected(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Menu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.filter((i) => !i.archived).length} items · {categories.length} categories
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="md" onClick={() => setBulkOpen(true)}>
            Import / export
          </Button>
          <Button variant="secondary" size="md" onClick={() => setManageCats((v) => !v)}>
            Categories
          </Button>
          <Button variant="secondary" size="md" onClick={() => setManageCombos((v) => !v)}>
            Combos
          </Button>
          <Button variant="secondary" size="md" onClick={() => setManageOffers((v) => !v)}>
            Offers
          </Button>
          <Button size="md" onClick={() => setDraft({ ...emptyDraft })}>
            Add item
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {manageCats && (
        <div className="mt-5 rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">Categories</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-1 text-[13px] text-foreground"
              >
                {c.name}
                {stations.length > 0 && (
                  <select
                    value={c.station_id ?? ''}
                    onChange={(e) => updateCategoryStation(c.id, e.target.value || null)}
                    aria-label={`Kitchen station for ${c.name}`}
                    className="h-6 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-1 text-[11.5px] text-foreground"
                  >
                    <option value="">No station</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => deleteCategory(c.id)}
                  aria-label={`Delete ${c.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
            {categories.length === 0 && (
              <span className="text-[13px] text-muted-foreground">No categories yet.</span>
            )}
          </div>
          {stations.length > 0 && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              A category&apos;s station routes its items to a kitchen printer bound to that station (set up
              under Settings → KOT printing). Manage the stations themselves there too.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              placeholder="New category name"
              className="h-9 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <Button size="sm" onClick={addCategory} loading={busy}>
              Add
            </Button>
          </div>

          {/* Category cross-sell rules — cold-start coverage without configuring
              every item. E.g. Pizza pairs with Dips + Soft Drinks. Owner/manager
              only — the RPC re-checks this regardless of the UI. */}
          {canSeeCost && categories.length > 1 && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-foreground">Category pairings</p>
                <div className="flex items-center gap-3">
                  <button onClick={autoSuggestPairings} disabled={savingPairs} className="text-[12px] font-medium text-primary hover:underline disabled:opacity-50">
                    {savingPairs ? 'Applying…' : 'Auto-suggest from category names'}
                  </button>
                  <button onClick={refreshRecommendationStats} disabled={refreshingStats} className="text-[12px] font-medium text-primary hover:underline disabled:opacity-50">
                    {refreshingStats ? 'Refreshing…' : 'Refresh sales-based ranking'}
                  </button>
                </div>
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Pick which category a category pairs well with (e.g. Pizza → Dips, Soft Drinks).</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button key={c.id} onClick={() => setPairingCat(pairingCat === c.id ? null : c.id)}
                    className={`rounded-full border px-3 py-1 text-[12.5px] font-medium ${pairingCat === c.id ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}>
                    {c.name}
                  </button>
                ))}
              </div>
              {pairingCat && (
                <div className="mt-2 flex flex-wrap gap-1.5 rounded-[var(--radius)] bg-surface-subtle p-2.5">
                  {categories.filter((c) => c.id !== pairingCat).map((c) => {
                    const on = (categoryPairs[pairingCat] ?? []).includes(c.id)
                    return (
                      <button key={c.id} onClick={() => toggleCategoryPair(pairingCat, c.id)} disabled={savingPairs}
                        className={`rounded-full border px-2.5 py-1 text-[12px] font-medium disabled:opacity-50 ${on ? 'border-success bg-success-subtle text-success' : 'border-border-strong bg-surface text-muted-foreground'}`}>
                        {on ? '✓ ' : '+ '}{c.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {manageCombos && (
        <CombosPanel
          cafeId={cafeId}
          cafeName={cafeName}
          canManage={canSeeCost}
          categories={categories}
          items={items}
          variants={variants}
          initialCombos={initialCombos}
          initialSlots={initialComboSlots}
        />
      )}

      {manageOffers && (
        <OffersPanel canManage={canSeeCost} items={items} onItemsChange={setItems} />
      )}

      {/* Toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items"
          className="h-9 w-full max-w-xs rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-sm text-foreground"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={availabilityFilter}
          onChange={(e) => setAvailabilityFilter(e.target.value as typeof availabilityFilter)}
          className="h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-sm text-foreground"
        >
          <option value="all">All</option>
          <option value="available">Available</option>
          <option value="sold_out">Sold out</option>
        </select>
      </div>

      {/* Bulk action bar — appears once anything is selected, for marking or
          deleting many items in one go instead of one at a time. */}
      {selectedIds.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-primary-subtle px-4 py-2.5">
          <span className="text-[13px] font-medium text-primary">{selectedIds.size} selected</span>
          <button
            onClick={() => bulkSetAvailable([...selectedIds], false)}
            className="min-h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] font-medium text-foreground hover:bg-surface-subtle"
          >
            Mark sold out
          </button>
          <button
            onClick={() => bulkSetAvailable([...selectedIds], true)}
            className="min-h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] font-medium text-foreground hover:bg-surface-subtle"
          >
            Mark available
          </button>
          <button
            onClick={() => bulkDelete([...selectedIds])}
            className="min-h-9 rounded-[var(--radius)] border border-destructive px-3 text-[13px] font-medium text-destructive hover:bg-destructive-subtle"
          >
            Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto min-h-9 px-2 text-[13px] text-primary hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Items */}
      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {items.length === 0 ? 'No menu items yet. Add your first one.' : 'No items match your filters.'}
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
          <li className="flex items-center gap-3 bg-surface-subtle px-4 py-2">
            <input
              type="checkbox"
              aria-label="Select all visible items"
              checked={visible.length > 0 && visible.every((i) => selectedIds.has(i.id))}
              onChange={(e) =>
                setSelectedIds(e.target.checked ? new Set(visible.map((i) => i.id)) : new Set())
              }
              className="h-4 w-4 shrink-0"
            />
            <span className="text-[12.5px] text-muted-foreground">Select all ({visible.length})</span>
          </li>
          {visible.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3 sm:flex-nowrap">
              <input
                type="checkbox"
                aria-label={`Select ${item.name}`}
                checked={selectedIds.has(item.id)}
                onChange={() => toggleSelected(item.id)}
                className="h-4 w-4 shrink-0"
              />
              {item.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover" />
              )}
              {/* basis-full forces this onto its own row on narrow phones so the
                  three action buttons below never crush the name down to a few
                  visible characters; at sm+ it shares the row as before. */}
              <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{item.name}</span>
                  {item.is_veg === true && (
                    <span className="rounded bg-success-subtle px-1.5 py-0.5 text-[11px] font-medium text-success">Veg</span>
                  )}
                  {item.is_veg === false && (
                    <span className="rounded bg-destructive-subtle px-1.5 py-0.5 text-[11px] font-medium text-destructive">Non-veg</span>
                  )}
                  {item.is_bestseller && (
                    <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-[11px] font-medium text-warning">Bestseller</span>
                  )}
                  {!item.available && (
                    <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Sold out</span>
                  )}
                </div>
                <p className="truncate text-[13px] text-muted-foreground">
                  ₹{item.price} · {catName(item.category_id)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => toggleAvailable(item)}
                  className="min-h-11 shrink-0 rounded-[var(--radius)] border border-border-strong px-3 text-[13px] text-muted-foreground hover:text-foreground"
                >
                  {item.available ? 'Mark sold out' : 'Mark available'}
                </button>
                <button
                  onClick={() => openEdit(item)}
                  className="min-h-11 shrink-0 rounded-[var(--radius)] px-3 text-[13px] text-primary hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteItem(item)}
                  aria-label={`Delete ${item.name}`}
                  className="min-h-11 shrink-0 rounded-[var(--radius)] px-3 text-[13px] text-muted-foreground hover:text-destructive"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Item editor modal. This form can get taller than a phone's viewport
          once variants/add-ons are added, so the panel itself scrolls
          (max-h + overflow-y-auto) — without this, Save could become
          physically unreachable on a small screen. */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
          {/* Rounding + clipping live on this outer flex container, scrolling
              on the inner one — a border-radius doesn't clip its own
              scrollbar, so combining both on one element leaves a sharp
              square notch where the scrollbar track meets the corner. */}
          <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-surface sm:max-h-[85dvh] sm:rounded-2xl">
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <h2 className="text-lg font-semibold text-foreground">
              {draft.id ? 'Edit item' : 'Add item'}
            </h2>

            <div className="mt-5 space-y-4">
              {/* Photo */}
              <div className="flex items-center gap-3">
                {draft.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.image_url} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-border-strong text-[11px] text-muted-foreground">
                    No photo
                  </div>
                )}
                <div className="space-y-1">
                  <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius)] border border-border-strong px-3 text-[13px] text-foreground hover:bg-surface-subtle">
                    {uploading ? 'Uploading…' : draft.image_url ? 'Change photo' : 'Add photo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => onPickImage(e.target.files?.[0])}
                    />
                  </label>
                  {draft.image_url && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, image_url: null })}
                      className="mt-1 min-h-11 px-1 text-[12px] text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <Input
                label="Name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <Input
                label="Selling price (₹)"
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />

              {/* Pricing & Cost — owner/manager only. Contribution/margin update
                  live and stay consistent when the price changes. */}
              {canSeeCost && (
                <div className="rounded-[var(--radius)] border border-border bg-surface-subtle p-3.5">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Pricing &amp; cost</p>
                  <div className="mt-2 flex gap-1 rounded-[var(--radius)] bg-surface p-1">
                    {(['manual', 'recipe'] as const).map((src) => (
                      <button
                        key={src}
                        type="button"
                        disabled={src === 'recipe' && !inventoryAllowed}
                        onClick={() => setDraft({ ...draft, cost_source: src })}
                        title={src === 'recipe' && !inventoryAllowed ? 'Needs the Inventory plan feature' : undefined}
                        className={`flex-1 rounded-[var(--radius-sm)] py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          draft.cost_source === src ? 'bg-primary-subtle text-primary' : 'text-muted-foreground'
                        }`}
                      >
                        {src === 'manual' ? 'I know my margin' : 'Recipe calculated'}
                      </button>
                    ))}
                  </div>

                  {draft.cost_source === 'recipe' && !inventoryAllowed && (
                    <p className="mt-3 rounded-[var(--radius)] bg-warning-subtle px-3 py-2 text-[12.5px] text-warning">
                      This item was set to recipe-calculated costing, but your current plan doesn&apos;t include Inventory —
                      margin isn&apos;t being worked out until you switch it to a manual margin or upgrade.
                    </p>
                  )}

                  {draft.cost_source === 'manual' ? (
                    <div className="mt-3">
                      <Input
                        label="Margin (₹)"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={draft.margin}
                        onChange={(e) => setDraft({ ...draft, margin: e.target.value })}
                        hint="What you keep on one. Optional, and only you ever see it."
                      />
                    </div>
                  ) : (
                    <p className="mt-3 rounded-[var(--radius)] bg-surface px-3 py-2 text-[12.5px] text-muted-foreground">
                      Margin is worked out from this item&apos;s recipe on the <span className="font-medium text-foreground">Recipes</span> page.
                    </p>
                  )}

                  {(() => {
                    const p = Math.round(Number(draft.price) || 0)
                    if (draft.cost_source !== 'manual' || draft.margin.trim() === '' || p <= 0) return null
                    // The two figures an owner didn't type: what it therefore
                    // costs to make, and the margin as a percentage.
                    const kept = Math.round(Number(draft.margin) || 0)
                    const cost = p - kept
                    const pct = (kept * 100) / p
                    return (
                      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                        <div className="rounded-[var(--radius)] bg-surface p-2">
                          <p className="text-[11px] text-muted-foreground">Costs you to make</p>
                          <p className={`text-[15px] font-semibold ${cost < 0 ? 'text-destructive' : 'text-foreground'}`}>₹{cost}</p>
                        </div>
                        <div className="rounded-[var(--radius)] bg-surface p-2">
                          <p className="text-[11px] text-muted-foreground">Margin</p>
                          <p className={`text-[15px] font-semibold ${pct < 0 ? 'text-destructive' : 'text-success'}`}>{pct.toFixed(1)}%</p>
                        </div>
                      </div>
                    )
                  })()}
                  {draft.cost_source === 'manual' &&
                    draft.margin.trim() !== '' &&
                    Math.round(Number(draft.margin) || 0) > Math.round(Number(draft.price) || 0) && (
                      <p className="mt-2 text-[12px] text-destructive">
                        Margin can&apos;t be more than the selling price.
                      </p>
                    )}
                </div>
              )}

              {/* Smart add-ons (cross-sell) — owner/manager. Separate menu items
                  suggested when this one is ordered (not modifiers). */}
              {canSeeCost && (
                <div className="rounded-[var(--radius)] border border-border bg-surface-subtle p-3.5">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Smart add-ons</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">Suggested alongside this item at checkout (e.g. a dip or drink). These are separate items — not modifiers.</p>
                  {draft.pairings.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {draft.pairings.map((pid) => {
                        const it = items.find((i) => i.id === pid)
                        return (
                          <button key={pid} type="button" onClick={() => setDraft({ ...draft, pairings: draft.pairings.filter((x) => x !== pid) })}
                            className="flex items-center gap-1 rounded-full border border-primary bg-primary-subtle px-2.5 py-1 text-[12px] font-medium text-primary">
                            {it?.name ?? 'Item'} <X size={12} />
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <input value={pairSearch} onChange={(e) => setPairSearch(e.target.value)} placeholder="Search items to suggest…"
                    className="mt-2 h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-sm text-foreground" />
                  {pairSearch.trim() && (
                    <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-[var(--radius)] border border-border bg-surface">
                      {items
                        .filter((i) => i.id !== draft.id && !draft.pairings.includes(i.id) && i.name.toLowerCase().includes(pairSearch.trim().toLowerCase()))
                        .slice(0, 12)
                        .map((i) => (
                          <li key={i.id}>
                            <button type="button" onClick={() => { setDraft({ ...draft, pairings: [...draft.pairings, i.id] }); setPairSearch('') }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-foreground hover:bg-surface-subtle">
                              <span>{i.name}</span><span className="text-muted-foreground">₹{i.price}</span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-foreground">Category</label>
                <select
                  value={draft.category_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
                  className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
                >
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-foreground">Description</label>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex flex-wrap gap-4 text-[13px]">
                <label className="flex items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.available}
                    onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
                  />
                  Available
                </label>
                <label className="flex items-center gap-2 text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.is_bestseller}
                    onChange={(e) => setDraft({ ...draft, is_bestseller: e.target.checked })}
                  />
                  Bestseller
                </label>
                <select
                  value={draft.is_veg === null ? '' : draft.is_veg ? 'veg' : 'nonveg'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      is_veg: e.target.value === '' ? null : e.target.value === 'veg',
                    })
                  }
                  className="h-8 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground"
                >
                  <option value="">Diet: n/a</option>
                  <option value="veg">Veg</option>
                  <option value="nonveg">Non-veg</option>
                </select>
              </div>

              {/* Variants */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-foreground">Sizes / Choices</span>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, variants: [...draft.variants, { name: '', price: '', margin: '' }] })}
                    className="text-[13px] text-primary hover:underline"
                  >
                    + Add
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Only if this is sold more than one way — Small/Medium/Large, 6 Slice, Steam/Fried. Give each one the
                  price a guest pays{canSeeCost && ' and the ₹ you keep'}. Leave empty if there&apos;s just one.
                </p>
                {/* px-3 mirrors the inputs' own padding so each label sits over
                    its value instead of 12px to the left of it, and the money
                    columns are right-aligned to match the figures beneath them
                    — a price column that starts at the left edge reads as
                    text, not as an amount. */}
                {draft.variants.length > 0 && (
                  <div className="mt-2 flex gap-2 text-[11.5px] text-muted-foreground">
                    <span className="flex-1 px-3">Name</span>
                    <span className="w-24 px-3 text-right">Price ₹</span>
                    {canSeeCost && <span className="w-24 px-3 text-right">Margin ₹</span>}
                    <span className="w-6" />
                  </div>
                )}
                {draft.variants.map((v, idx) => (
                  <div key={idx} className="mt-1.5 flex gap-2">
                    <input
                      value={v.name}
                      onChange={(e) => setDraft({ ...draft, variants: draft.variants.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)) })}
                      placeholder="e.g. Large"
                      className="h-9 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
                    />
                    <input
                      value={v.price}
                      type="number"
                      min={0}
                      onChange={(e) => setDraft({ ...draft, variants: draft.variants.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)) })}
                      placeholder="149"
                      title="What a guest pays for this one"
                      className="h-9 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-right text-sm tabular-nums text-foreground"
                    />
                    {canSeeCost && (
                      <input
                        value={v.margin}
                        type="number"
                        min={0}
                        onChange={(e) => setDraft({ ...draft, variants: draft.variants.map((x, i) => (i === idx ? { ...x, margin: e.target.value } : x)) })}
                        placeholder="optional"
                        title="What you keep on this one. Only you see it."
                        className="h-9 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-right text-sm tabular-nums text-foreground"
                      />
                    )}
                    <button type="button" onClick={() => setDraft({ ...draft, variants: draft.variants.filter((_, i) => i !== idx) })} aria-label="Remove option" className="w-6 text-muted-foreground hover:text-destructive">×</button>
                  </div>
                ))}
              </div>

              {/* Add-ons */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-foreground">Add-ons</span>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, addons: [...draft.addons, { name: '', price: '0' }] })}
                    className="text-[13px] text-primary hover:underline"
                  >
                    + Add
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Optional extras customers can add (e.g. Oat milk +₹50).</p>
                {draft.addons.map((a, idx) => (
                  <div key={idx} className="mt-2 flex gap-2">
                    <input
                      value={a.name}
                      onChange={(e) => setDraft({ ...draft, addons: draft.addons.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)) })}
                      placeholder="e.g. Extra shot"
                      className="h-9 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
                    />
                    <input
                      value={a.price}
                      type="number"
                      min={0}
                      onChange={(e) => setDraft({ ...draft, addons: draft.addons.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)) })}
                      placeholder="₹"
                      className="h-9 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-right text-sm tabular-nums text-foreground"
                    />
                    <button type="button" onClick={() => setDraft({ ...draft, addons: draft.addons.filter((_, i) => i !== idx) })} aria-label="Remove add-on" className="w-6 text-muted-foreground hover:text-destructive">×</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={saveItem} loading={busy}>
                {draft.id ? 'Save' : 'Add item'}
              </Button>
            </div>
          </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <BulkImportPanel
          cafeId={cafeId}
          cafeName={cafeName}
          categories={categories}
          items={items}
          onClose={() => setBulkOpen(false)}
          onImported={refetchMenu}
        />
      )}
    </div>
  )
}
