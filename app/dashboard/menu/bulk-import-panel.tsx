'use client'

import { useRef, useState } from 'react'
import { Upload, Download, FileSpreadsheet, X, AlertTriangle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { parseMenuFile, markUpdatesVsInserts, type ParseResult } from '@/lib/menu-import'
import { downloadMenuTemplate, downloadMenuExport, readWorkbookRows } from '@/lib/menu-workbook'
import { suggestCategoryPairings, type CategorySuggestion } from '@/lib/recommend'
import type { MenuCategory, MenuItemRow } from './types'

export default function BulkImportPanel({
  cafeId,
  cafeName,
  categories,
  items,
  onClose,
  onImported,
}: {
  cafeId: string
  cafeName: string
  categories: MenuCategory[]
  items: MenuItemRow[]
  onClose: () => void
  onImported: () => void
}) {
  const supabase = useRef(createClient()).current
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // Optional post-import review — deterministic keyword heuristic, never AI,
  // never required (spec §3, §18). Owner approves before anything activates.
  const [suggestions, setSuggestions] = useState<(CategorySuggestion & { catName: string; suggestedName: string })[] | null>(null)
  const [approving, setApproving] = useState(false)

  const catNameById = new Map(categories.map((c) => [c.id, c.name]))

  async function onPickFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setFileError(null)
    setResult(null)
    setParsing(true)
    try {
      const rows = await readWorkbookRows(file)
      const parsed = parseMenuFile(rows)
      if (parsed.totalItems === 0) {
        setFileError('No items were found in this file. Check it matches the template format.')
        setParsing(false)
        return
      }
      const existing = items.map((i) => ({
        categoryName: i.category_id ? (catNameById.get(i.category_id) ?? 'Uncategorised') : 'Uncategorised',
        itemName: i.name,
      }))
      setResult(markUpdatesVsInserts(parsed, existing))
    } catch {
      setFileError('Could not read this file. Make sure it\'s a .csv or .xlsx export from Excel/Google Sheets.')
    } finally {
      setParsing(false)
    }
  }

  function exportCurrentMenu() {
    const rows = items
      .filter((i) => !i.archived)
      .map((i) => ({
        category: i.category_id ? (catNameById.get(i.category_id) ?? 'Uncategorised') : 'Uncategorised',
        name: i.name,
        price: i.price,
        isVeg: i.is_veg,
        description: i.description,
      }))
    downloadMenuExport(cafeName, rows)
  }

  async function confirmImport() {
    if (!result) return
    setImporting(true)
    try {
      // 1. Resolve categories: match existing (case-insensitive, trimmed),
      //    create the rest in one batch so re-importing never duplicates a
      //    category that already exists.
      const existingByLower = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]))
      const toCreate = result.byCategory
        .map((c) => c.name.trim())
        .filter((name) => !existingByLower.has(name.toLowerCase()))
        .filter((name, i, arr) => arr.findIndex((n) => n.toLowerCase() === name.toLowerCase()) === i)

      if (toCreate.length) {
        const startSort = categories.length
        const { data: created, error } = await supabase
          .from('menu_categories')
          .insert(toCreate.map((name, i) => ({ cafe_id: cafeId, name, sort: startSort + i })))
          .select('id, name')
        if (error) throw new Error(error.message)
        for (const c of created ?? []) existingByLower.set(c.name.trim().toLowerCase(), c.id)
      }

      // 2. Resolve existing items for update-matching, and track the running
      //    max sort per category so new items append in file order.
      const existingItemByKey = new Map(
        items.map((i) => [
          `${(i.category_id ? catNameById.get(i.category_id) : 'Uncategorised')?.trim().toLowerCase()}::${i.name.trim().toLowerCase()}`,
          i,
        ]),
      )
      const nextSort = new Map<string, number>()
      for (const i of items) {
        const cid = i.category_id ?? '__none'
        nextSort.set(cid, Math.max(nextSort.get(cid) ?? -1, i.sort) + 1)
      }

      const updates: { id: string; price: number; description: string | null; is_veg: boolean | null; cost: number | null }[] = []
      const inserts: {
        cafe_id: string
        category_id: string
        name: string
        price: number
        cost: number | null
        description: string | null
        is_veg: boolean | null
        sort: number
      }[] = []

      for (const cat of result.byCategory) {
        const categoryId = existingByLower.get(cat.name.trim().toLowerCase())!
        for (const item of cat.items) {
          const key = `${cat.name.trim().toLowerCase()}::${item.name.trim().toLowerCase()}`
          const existingMatch = existingItemByKey.get(key)
          if (existingMatch) {
            updates.push({ id: existingMatch.id, price: item.price, description: item.description, is_veg: item.isVeg, cost: item.cost })
          } else {
            const sort = nextSort.get(categoryId) ?? 0
            nextSort.set(categoryId, sort + 1)
            inserts.push({
              cafe_id: cafeId,
              category_id: categoryId,
              name: item.name,
              price: item.price,
              // Optional — null leaves cost unset (cost_source defaults to 'manual').
              cost: item.cost,
              description: item.description,
              is_veg: item.isVeg,
              sort,
            })
          }
        }
      }

      if (inserts.length) {
        const { error } = await supabase.from('menu_items').insert(inserts)
        if (error) throw new Error(error.message)
      }
      if (updates.length) {
        const results = await Promise.all(
          updates.map((u) =>
            supabase
              .from('menu_items')
              // Only overwrite cost when the file actually supplied one — a
              // re-import without a cost column must not blank existing costs.
              .update({ price: u.price, description: u.description, is_veg: u.is_veg, ...(u.cost != null ? { cost: u.cost } : {}) })
              .eq('id', u.id),
          ),
        )
        const failed = results.find((r) => r.error)
        if (failed?.error) throw new Error(failed.error.message)
      }

      toast(`Menu imported — ${inserts.length} new, ${updates.length} updated.`)
      onImported()

      // Optional: suggest category pairings from a zero-cost keyword heuristic
      // (no AI, no external call). Purely a review step — nothing is activated
      // until the owner approves. Skip quietly on any hiccup.
      try {
        const { data: existingCatPairs } = await supabase.from('category_pairings').select('category_id, suggested_category_id').eq('cafe_id', cafeId)
        const already = new Set((existingCatPairs ?? []).map((r) => `${r.category_id}:${r.suggested_category_id}`))
        const catList = [...existingByLower.entries()].map(([name, id]) => ({ id, name }))
        const catNameById = new Map(catList.map((c) => [c.id, c.name]))
        const raw = suggestCategoryPairings(catList).filter((s) => !already.has(`${s.categoryId}:${s.suggestedCategoryId}`))
        if (raw.length > 0) {
          setSuggestions(raw.map((s) => ({ ...s, catName: catNameById.get(s.categoryId) ?? '', suggestedName: catNameById.get(s.suggestedCategoryId) ?? '' })))
          return // hold the panel open on the review step instead of closing
        }
      } catch {
        /* suggestion step is optional — never block the import success path */
      }
      onClose()
    } catch (e) {
      setFileError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function approveSuggestions(only?: string) {
    if (!suggestions) return
    const toApprove = only ? suggestions.filter((s) => `${s.categoryId}:${s.suggestedCategoryId}` === only) : suggestions
    setApproving(true)
    // Merge with whatever each category already has (set_category_pairings
    // replaces-all for one category), then group approvals by category.
    const byCategory = new Map<string, Set<string>>()
    for (const s of toApprove) {
      if (!byCategory.has(s.categoryId)) {
        const { data } = await supabase.from('category_pairings').select('suggested_category_id').eq('cafe_id', cafeId).eq('category_id', s.categoryId)
        byCategory.set(s.categoryId, new Set((data ?? []).map((r) => r.suggested_category_id as string)))
      }
      byCategory.get(s.categoryId)!.add(s.suggestedCategoryId)
    }
    for (const [catId, set] of byCategory) {
      await supabase.rpc('set_category_pairings', { p_cafe_id: cafeId, p_category_id: catId, p_suggested: [...set] })
    }
    setApproving(false)
    const remaining = only ? suggestions.filter((s) => `${s.categoryId}:${s.suggestedCategoryId}` !== only) : []
    setSuggestions(remaining.length ? remaining : null)
    toast(only ? 'Pairing added.' : 'All suggested pairings added.')
    if (remaining.length === 0) onClose()
  }

  if (suggestions && suggestions.length > 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
        <div className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:max-h-[80dvh] sm:rounded-[var(--radius-lg)]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold text-foreground">Smart recommendations</h2>
            <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center text-muted-foreground"><X size={18} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <p className="text-[13px] text-muted-foreground">
              KhaoPiyo found potential complementary pairings from your menu&apos;s category names. Nothing is active until you approve it.
            </p>
            <div className="mt-3 space-y-2">
              {suggestions.map((s) => {
                const key = `${s.categoryId}:${s.suggestedCategoryId}`
                return (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-foreground">{s.catName} → {s.suggestedName}</p>
                      <p className="text-[12px] text-muted-foreground">Reason: {s.reason}</p>
                    </div>
                    <button onClick={() => approveSuggestions(key)} disabled={approving} className="shrink-0 rounded-full border border-primary px-3 py-1.5 text-[12.5px] font-medium text-primary hover:bg-primary-subtle disabled:opacity-50">Add</button>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex gap-2 border-t border-border p-4">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Skip</Button>
            <Button className="flex-1" loading={approving} onClick={() => approveSuggestions()}>Add all ({suggestions.length})</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">Import / export menu</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!result && (
            <div className="space-y-3">
              <button
                onClick={() => downloadMenuTemplate(cafeName)}
                className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] border border-border-strong px-4 text-left text-sm font-medium text-foreground hover:bg-surface-subtle"
              >
                <Download size={17} className="shrink-0 text-primary" />
                Download menu template
              </button>
              <button
                onClick={exportCurrentMenu}
                disabled={items.length === 0}
                className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] border border-border-strong px-4 text-left text-sm font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40"
              >
                <FileSpreadsheet size={17} className="shrink-0 text-primary" />
                Export current menu
              </button>

              <div className="border-t border-border pt-4">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-border-strong text-center hover:border-primary hover:bg-primary-subtle"
                >
                  <Upload size={20} className="text-primary" />
                  <span className="text-sm font-medium text-foreground">
                    {parsing ? 'Reading file…' : fileName ? fileName : 'Import menu — choose a .csv or .xlsx file'}
                  </span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
              </div>

              {fileError && (
                <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{fileError}</p>
              )}

              <p className="pt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                In the template, type a category name on its own row (like <b>BURGERS</b>), then list its items
                underneath with a price. Start a new category the same way whenever you want. Blank rows are fine.
              </p>
            </div>
          )}

          {result && (
            <div>
              <div className="rounded-[var(--radius)] bg-primary-subtle px-3 py-2.5 text-[13px] font-medium text-primary">
                {result.byCategory.length} categories · {result.totalItems} items — {result.insertCount} new
                {result.updateCount > 0 ? `, ${result.updateCount} will be updated` : ''}
              </div>

              {result.issues.length > 0 && (
                <div className="mt-3 rounded-[var(--radius)] border border-warning bg-warning-subtle px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warning">
                    <AlertTriangle size={14} /> {result.issues.length} thing{result.issues.length === 1 ? '' : 's'} to check
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[12px] text-warning">
                    {result.issues.map((iss, i) => (
                      <li key={i}>Row {iss.row}: {iss.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 space-y-4">
                {result.byCategory.map((cat) => (
                  <div key={cat.name}>
                    <p className="text-[13px] font-semibold uppercase tracking-wide text-foreground">
                      {cat.name} ({cat.items.length})
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {cat.items.map((it, i) => (
                        <li key={i} className="text-[13.5px] text-muted-foreground">
                          • {it.name} — ₹{it.price}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {fileError && (
                <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{fileError}</p>
              )}
            </div>
          )}
        </div>

        {result && (
          <div className="flex shrink-0 gap-2 border-t border-border p-5">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setResult(null)
                setFileName(null)
                setFileError(null)
                if (fileRef.current) fileRef.current.value = ''
              }}
            >
              Choose a different file
            </Button>
            <Button className="flex-1" onClick={confirmImport} loading={importing}>
              Confirm import
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
