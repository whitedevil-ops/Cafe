'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

export type CostRow = {
  menu_item_id: string
  name: string
  price: number
  food_cost: number
  margin: number
  margin_pct: number
  ingredients: number
  missing_cost: number
}
export type RecipeRow = { id: string; menu_item_id: string; inventory_item_id: string; qty: number }
export type InventoryOption = { id: string; name: string; unit: string; cost: number | null }

export default function RecipesClient({
  cafeId,
  canManage,
  initialCosts,
  initialRecipes,
  inventory,
  autoDeduct,
}: {
  cafeId: string
  canManage: boolean
  initialCosts: CostRow[]
  initialRecipes: RecipeRow[]
  inventory: InventoryOption[]
  autoDeduct: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [costs, setCosts] = useState(initialCosts)
  const [recipes, setRecipes] = useState(initialRecipes)
  const [deduct, setDeduct] = useState(autoDeduct)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pickItem, setPickItem] = useState('')
  const [pickQty, setPickQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invById = useMemo(() => new Map(inventory.map((i) => [i.id, i])), [inventory])
  const recipesByItem = useMemo(() => {
    const m = new Map<string, RecipeRow[]>()
    recipes.forEach((r) => m.set(r.menu_item_id, [...(m.get(r.menu_item_id) ?? []), r]))
    return m
  }, [recipes])

  async function refreshCosts() {
    const { data } = await supabase.rpc('menu_item_costs', { p_cafe_id: cafeId })
    if (data) setCosts(data as CostRow[])
  }

  async function addIngredient(menuItemId: string) {
    const qty = Number(pickQty)
    if (!pickItem) return setError('Choose an ingredient.')
    if (!qty || qty <= 0) return setError('Enter a quantity greater than 0.')
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('recipe_items')
      .insert({ cafe_id: cafeId, menu_item_id: menuItemId, inventory_item_id: pickItem, qty })
      .select('id, menu_item_id, inventory_item_id, qty')
      .single()
    setBusy(false)
    if (err) {
      return setError(
        err.code === '23505'
          ? 'That ingredient is already in this recipe — remove it first to change the quantity.'
          : err.message,
      )
    }
    setRecipes((list) => [...list, data as RecipeRow])
    setPickItem('')
    setPickQty('')
    void refreshCosts()
  }

  async function removeIngredient(id: string) {
    setRecipes((list) => list.filter((r) => r.id !== id))
    const { error: err } = await supabase.from('recipe_items').delete().eq('id', id)
    if (err) return toast(err.message, 'error')
    void refreshCosts()
  }

  async function toggleDeduct(next: boolean) {
    setDeduct(next)
    const { error: err } = await supabase.from('cafes').update({ auto_deduct_stock: next }).eq('id', cafeId)
    if (err) {
      setDeduct(!next)
      return toast(err.message, 'error')
    }
    toast(next ? 'Stock will now be deducted automatically as orders are placed.' : 'Automatic stock deduction is off.')
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Recipes &amp; food cost</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell each dish what it&apos;s made of, and see what it actually costs you to serve.
      </p>

      {canManage && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">Deduct stock automatically</h2>
              <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
                When an order is placed, subtract each dish&apos;s ingredients from inventory. Leave this off until
                your recipes are complete and accurate — otherwise your stock numbers will drift.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={deduct}
              aria-label="Deduct stock automatically"
              onClick={() => toggleDeduct(!deduct)}
              className={`h-7 w-12 shrink-0 rounded-full transition-colors ${deduct ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'}`}
            >
              <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${deduct ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </section>
      )}

      {inventory.length === 0 && (
        <p className="mt-6 rounded-[var(--radius)] bg-warning-subtle px-3 py-2.5 text-[13px] text-warning">
          No inventory items yet — add ingredients under Inventory first, then come back to build recipes.
        </p>
      )}

      <ul className="mt-6 space-y-2">
        {costs.map((c) => {
          const rows = recipesByItem.get(c.menu_item_id) ?? []
          const open = expanded === c.menu_item_id
          return (
            <li key={c.menu_item_id} className="rounded-xl border border-border bg-surface p-4">
              <button
                onClick={() => { setExpanded(open ? null : c.menu_item_id); setError(null); setPickItem(''); setPickQty('') }}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{c.name}</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {rows.length === 0 ? (
                      'No recipe yet'
                    ) : (
                      <>
                        Costs ₹{Number(c.food_cost).toFixed(2)} · margin ₹{Number(c.margin).toFixed(2)} ({c.margin_pct}%)
                        {c.missing_cost > 0 && (
                          <span className="text-warning"> · {c.missing_cost} ingredient{c.missing_cost === 1 ? '' : 's'} missing a cost</span>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-foreground">₹{c.price}</span>
              </button>

              {open && (
                <div className="mt-3 border-t border-border pt-3">
                  {rows.length > 0 && (
                    <ul className="space-y-1.5">
                      {rows.map((r) => {
                        const inv = invById.get(r.inventory_item_id)
                        return (
                          <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
                            <span className="min-w-0 truncate text-foreground">
                              {r.qty} {inv?.unit ?? ''} {inv?.name ?? 'Unknown ingredient'}
                              {inv?.cost == null && <span className="text-warning"> · no cost set</span>}
                            </span>
                            {canManage && (
                              <button onClick={() => removeIngredient(r.id)} className="min-h-8 shrink-0 px-2 text-[12px] text-destructive hover:underline">
                                Remove
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {canManage && inventory.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 space-y-1">
                        <span className="block text-[12px] text-muted-foreground">Ingredient</span>
                        <select
                          value={pickItem}
                          onChange={(e) => setPickItem(e.target.value)}
                          className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground"
                        >
                          <option value="">Choose…</option>
                          {inventory.map((i) => (
                            <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                          ))}
                        </select>
                      </label>
                      <label className="w-28 space-y-1">
                        <span className="block text-[12px] text-muted-foreground">Qty</span>
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          value={pickQty}
                          onChange={(e) => setPickQty(e.target.value)}
                          className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground"
                        />
                      </label>
                      <Button onClick={() => addIngredient(c.menu_item_id)} loading={busy} size="sm">Add</Button>
                    </div>
                  )}

                  {error && open && (
                    <p className="mt-2 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {costs.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No menu items yet.</p>}
    </div>
  )
}
