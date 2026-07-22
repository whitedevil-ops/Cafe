'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { uploadMenuImage } from '@/lib/image-upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { MenuCategory, MenuItemRow } from './types'

type VariantDraft = { id?: string; name: string; price_delta: string }
type AddonDraft = { id?: string; name: string; price: string }

type ItemDraft = {
  id?: string
  name: string
  description: string
  category_id: string | null
  price: string
  image_url: string | null
  available: boolean
  is_veg: boolean | null
  is_bestseller: boolean
  variants: VariantDraft[]
  addons: AddonDraft[]
}

const emptyDraft: ItemDraft = {
  name: '',
  description: '',
  category_id: null,
  price: '',
  image_url: null,
  available: true,
  is_veg: null,
  is_bestseller: false,
  variants: [],
  addons: [],
}

export default function MenuManager({
  cafeId,
  initialCategories,
  initialItems,
}: {
  cafeId: string
  initialCategories: MenuCategory[]
  initialItems: MenuItemRow[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()
  const [categories, setCategories] = useState(initialCategories)
  const [items, setItems] = useState(initialItems)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'sold_out'>('all')

  const [draft, setDraft] = useState<ItemDraft | null>(null)
  const [manageCats, setManageCats] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorised'

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
  async function addCategory() {
    const name = newCat.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    const sort = categories.length
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ cafe_id: cafeId, name, sort })
      .select()
      .single()
    setBusy(false)
    if (error) return setError(error.message)
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

  // ── Item CRUD ──────────────────────────────────────────────────────────────
  async function saveItem() {
    if (!draft) return
    const name = draft.name.trim()
    const price = Math.round(Number(draft.price))
    if (!name) return setError('Item name is required.')
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price in rupees.')

    setBusy(true)
    setError(null)
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
        return setError(error.message)
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
        return setError(error.message)
      }
      itemId = (data as MenuItemRow).id
      setItems((list) => [...list, data as MenuItemRow])
    }

    // Sync variants + add-ons: simplest correct approach at this scale is
    // replace-all (delete then insert the current set).
    const err = await syncModifiers(itemId!, draft)
    setBusy(false)
    if (err) return setError(err)
    toast(draft.id ? 'Item updated.' : 'Item added to menu.')
    setDraft(null)
  }

  async function syncModifiers(itemId: string, d: ItemDraft): Promise<string | null> {
    await supabase.from('menu_item_variants').delete().eq('menu_item_id', itemId)
    await supabase.from('menu_item_addons').delete().eq('menu_item_id', itemId)

    const variants = d.variants
      .filter((v) => v.name.trim())
      .map((v, i) => ({ menu_item_id: itemId, name: v.name.trim(), price_delta: Math.round(Number(v.price_delta) || 0), sort: i }))
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
      image_url: item.image_url,
      available: item.available,
      is_veg: item.is_veg,
      is_bestseller: item.is_bestseller,
      variants: [],
      addons: [],
    })
    const [{ data: vs }, { data: as }] = await Promise.all([
      supabase.from('menu_item_variants').select('id, name, price_delta').eq('menu_item_id', item.id).order('sort'),
      supabase.from('menu_item_addons').select('id, name, price').eq('menu_item_id', item.id).order('sort'),
    ])
    setDraft((d) =>
      d && d.id === item.id
        ? {
            ...d,
            variants: (vs ?? []).map((v) => ({ id: v.id, name: v.name, price_delta: String(v.price_delta) })),
            addons: (as ?? []).map((a) => ({ id: a.id, name: a.name, price: String(a.price) })),
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
      .from('menu_items')
      .update({ available: !item.available })
      .eq('id', item.id)
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Menu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.filter((i) => !i.archived).length} items · {categories.length} categories
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="md" onClick={() => setManageCats((v) => !v)}>
            Categories
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
        </div>
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

      {/* Items */}
      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {items.length === 0 ? 'No menu items yet. Add your first one.' : 'No items match your filters.'}
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {visible.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3 sm:flex-nowrap">
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
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 sm:max-h-[85dvh] sm:rounded-2xl">
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
                label="Price (₹)"
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
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
                  <span className="text-[13px] font-medium text-foreground">Variants</span>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, variants: [...draft.variants, { name: '', price_delta: '0' }] })}
                    className="text-[13px] text-primary hover:underline"
                  >
                    + Add
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Sizes/options. Final price is base {draft.price ? `(₹${draft.price})` : ''} plus this amount. Leave empty for none.
                </p>
                {draft.variants.map((v, idx) => (
                  <div key={idx} className="mt-2 flex gap-2">
                    <input
                      value={v.name}
                      onChange={(e) => setDraft({ ...draft, variants: draft.variants.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)) })}
                      placeholder="e.g. Large"
                      className="h-9 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
                    />
                    <input
                      value={v.price_delta}
                      type="number"
                      onChange={(e) => setDraft({ ...draft, variants: draft.variants.map((x, i) => (i === idx ? { ...x, price_delta: e.target.value } : x)) })}
                      placeholder="+₹"
                      className="h-9 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
                    />
                    <button type="button" onClick={() => setDraft({ ...draft, variants: draft.variants.filter((_, i) => i !== idx) })} aria-label="Remove variant" className="px-2 text-muted-foreground hover:text-destructive">×</button>
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
                      className="h-9 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
                    />
                    <button type="button" onClick={() => setDraft({ ...draft, addons: draft.addons.filter((_, i) => i !== idx) })} aria-label="Remove add-on" className="px-2 text-muted-foreground hover:text-destructive">×</button>
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
      )}
    </div>
  )
}
