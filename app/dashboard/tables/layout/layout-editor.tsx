'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'

export type Area = { id: string; name: string; sort: number; archived: boolean }
export type LayoutTable = {
  id: string
  label: string
  capacity: number | null
  area_id: string | null
  archived: boolean
}

// New rows use a temporary client id so save can tell insert vs update — the
// RPC treats a missing/empty id as an insert.
let seq = 0
const tmp = () => `new-${Date.now()}-${seq++}`
const isNew = (id: string) => id.startsWith('new-')

export default function FloorLayoutEditor({
  cafeId,
  initialAreas,
  initialTables,
}: {
  cafeId: string
  initialAreas: Area[]
  initialTables: LayoutTable[]
}) {
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [areas, setAreas] = useState<Area[]>(
    initialAreas.length ? initialAreas : [{ id: tmp(), name: 'Ground Floor', sort: 0, archived: false }],
  )
  const firstAreaId = (initialAreas.length ? initialAreas : areas)[0]?.id ?? ''
  const [tables, setTables] = useState<LayoutTable[]>(
    initialTables.map((t) => (t.area_id ? t : { ...t, area_id: firstAreaId })),
  )
  const [activeArea, setActiveArea] = useState<string>(firstAreaId)
  const [saving, setSaving] = useState(false)

  const visibleAreas = areas.filter((a) => !a.archived).sort((a, b) => a.sort - b.sort)
  const areaTables = tables.filter((t) => !t.archived && t.area_id === activeArea)

  // ── Floors ──────────────────────────────────────────────────────────────
  function addArea() {
    const a: Area = { id: tmp(), name: `Floor ${visibleAreas.length + 1}`, sort: visibleAreas.length, archived: false }
    setAreas((list) => [...list, a])
    setActiveArea(a.id)
  }
  function renameArea(id: string, name: string) {
    setAreas((list) => list.map((a) => (a.id === id ? { ...a, name } : a)))
  }
  function moveArea(id: string, dir: -1 | 1) {
    const ordered = [...visibleAreas]
    const i = ordered.findIndex((a) => a.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ordered.length) return
    ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
    const sortById = new Map(ordered.map((a, idx) => [a.id, idx]))
    setAreas((list) => list.map((a) => (sortById.has(a.id) ? { ...a, sort: sortById.get(a.id)! } : a)))
  }
  function archiveArea(id: string) {
    if (tables.some((t) => t.area_id === id && !t.archived)) return toast('Move or remove this floor’s tables first.', 'error')
    setAreas((list) => list.map((a) => (a.id === id ? { ...a, archived: true } : a)))
    const next = visibleAreas.find((a) => a.id !== id)
    if (next) setActiveArea(next.id)
  }

  // ── Tables ──────────────────────────────────────────────────────────────
  function addTable() {
    if (!activeArea) return
    const label = String(tables.filter((t) => !t.archived).length + 1).padStart(2, '0')
    setTables((list) => [...list, { id: tmp(), label: `T${label}`, capacity: 4, area_id: activeArea, archived: false }])
  }
  function patchTable(id: string, patch: Partial<LayoutTable>) {
    setTables((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }
  function archiveTable(id: string) {
    setTables((list) => list.map((t) => (t.id === id ? { ...t, archived: true } : t)))
  }

  async function save() {
    setSaving(true)
    const payloadAreas = areas.map((a) => ({ id: isNew(a.id) ? null : a.id, name: a.name, sort: a.sort, archived: a.archived }))
    const payloadTables = tables.map((t) => ({
      id: isNew(t.id) ? null : t.id,
      label: t.label,
      capacity: t.capacity ?? null,
      // Tables assigned to a brand-new (unsaved) floor can't reference its tmp
      // id — save the floors first, then re-open to place those tables.
      area_id: t.area_id && !isNew(t.area_id) ? t.area_id : null,
      archived: t.archived,
    }))
    const { error } = await supabase.rpc('save_floor_layout', { p_cafe_id: cafeId, p_areas: payloadAreas, p_tables: payloadTables })
    setSaving(false)
    if (error) return toast(error.message, 'error')
    toast('Floors & tables saved.')
    router.refresh()
  }

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Floors &amp; tables</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Group your tables by floor or area. This is the single source of truth — the same floors and tables appear in POS, Live Tables and QR management.
          </p>
        </div>
        <button onClick={save} disabled={saving} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Floors */}
      <div className="mt-6">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Floors / areas</p>
        <div className="mt-2 space-y-2">
          {visibleAreas.map((a, i) => (
            <div key={a.id} className={`flex items-center gap-2 rounded-[var(--radius)] border p-2 ${activeArea === a.id ? 'border-primary bg-primary-subtle' : 'border-border bg-surface'}`}>
              <button onClick={() => setActiveArea(a.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-muted-foreground">{i + 1}</button>
              <input value={a.name} onFocus={() => setActiveArea(a.id)} onChange={(e) => renameArea(a.id, e.target.value)}
                className="min-w-0 flex-1 bg-transparent px-1 text-[14px] font-medium text-foreground outline-none" />
              <span className="shrink-0 text-[12px] text-muted-foreground">{tables.filter((t) => t.area_id === a.id && !t.archived).length} tables</span>
              <button onClick={() => moveArea(a.id, -1)} disabled={i === 0} aria-label="Move up" className="grid h-8 w-8 place-items-center text-muted-foreground disabled:opacity-30"><ChevronUp size={15} /></button>
              <button onClick={() => moveArea(a.id, 1)} disabled={i === visibleAreas.length - 1} aria-label="Move down" className="grid h-8 w-8 place-items-center text-muted-foreground disabled:opacity-30"><ChevronDown size={15} /></button>
              {visibleAreas.length > 1 && (
                <button onClick={() => archiveArea(a.id)} aria-label="Archive floor" className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-destructive"><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>
        <button onClick={addArea} className="mt-2 flex items-center gap-1.5 rounded-[var(--radius)] border border-dashed border-border-strong px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-surface-subtle">
          <Plus size={15} /> Add floor / area
        </button>
      </div>

      {/* Tables in the active floor */}
      <div className="mt-8">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tables in {visibleAreas.find((a) => a.id === activeArea)?.name ?? 'this floor'}
        </p>
        <div className="mt-2 space-y-2">
          {areaTables.length === 0 && <p className="rounded-[var(--radius)] border border-border bg-surface-subtle px-3 py-3 text-[13px] text-muted-foreground">No tables here yet.</p>}
          {areaTables.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-surface p-2">
              <div className="min-w-0 flex-1">
                <label className="block text-[11px] text-muted-foreground">Name</label>
                <input value={t.label} onChange={(e) => patchTable(t.id, { label: e.target.value })} className="h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-sm text-foreground" />
              </div>
              <div className="w-20">
                <label className="block text-[11px] text-muted-foreground">Seats</label>
                <input type="number" min={1} value={t.capacity ?? ''} onChange={(e) => patchTable(t.id, { capacity: e.target.value ? Number(e.target.value) : null })} className="h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-sm text-foreground" />
              </div>
              {visibleAreas.length > 1 && (
                <div className="w-36">
                  <label className="block text-[11px] text-muted-foreground">Floor</label>
                  <select value={t.area_id ?? ''} onChange={(e) => patchTable(t.id, { area_id: e.target.value || null })} className="h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-sm text-foreground">
                    {visibleAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <button onClick={() => archiveTable(t.id)} aria-label="Remove table" className="mt-4 grid h-9 w-9 shrink-0 place-items-center text-muted-foreground hover:text-destructive"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button onClick={addTable} disabled={!activeArea} className="mt-2 flex items-center gap-1.5 rounded-[var(--radius)] border border-dashed border-border-strong px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-surface-subtle disabled:opacity-40">
          <Plus size={15} /> Add table
        </button>
        <p className="mt-3 text-[12px] text-muted-foreground">Removing a table that has an active session is blocked automatically. Renaming keeps its history, bills and QR code intact.</p>
      </div>
    </div>
  )
}
