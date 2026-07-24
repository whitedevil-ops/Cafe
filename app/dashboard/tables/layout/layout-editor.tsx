'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Plus, Lock, Pencil, Square, RectangleHorizontal, Circle, Trash2, X } from 'lucide-react'

export type Area = { id: string; name: string; sort: number; archived: boolean }
export type LayoutTable = {
  id: string
  label: string
  capacity: number | null
  shape: 'square' | 'rectangle' | 'round'
  area_id: string | null
  pos_x: number | null
  pos_y: number | null
  archived: boolean
}

// New rows use a temporary client id (prefixed) so save can tell insert vs
// update — the RPC treats a missing/empty id as an insert.
let seq = 0
const tmp = () => `new-${Date.now()}-${seq++}`
const isNew = (id: string) => id.startsWith('new-')

const SHAPES = [
  { key: 'square', icon: Square, label: 'Square' },
  { key: 'rectangle', icon: RectangleHorizontal, label: 'Rectangle' },
  { key: 'round', icon: Circle, label: 'Round' },
] as const

export default function FloorLayoutEditor({
  cafeId,
  initialAreas,
  initialTables,
}: {
  cafeId: string
  initialAreas: Area[]
  initialTables: LayoutTable[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const { toast } = useToast()

  const [areas, setAreas] = useState<Area[]>(
    initialAreas.length ? initialAreas : [{ id: tmp(), name: 'Ground Floor', sort: 0, archived: false }],
  )
  // Tables created before areas existed (onboarding/manage screen) have no area.
  // Land them in the first area so they're visible and can be arranged.
  const firstAreaId = (initialAreas.length ? initialAreas : areas)[0]?.id ?? ''
  const [tables, setTables] = useState<LayoutTable[]>(
    initialTables.map((t) => (t.area_id ? t : { ...t, area_id: firstAreaId })),
  )
  const [activeArea, setActiveArea] = useState<string>(firstAreaId)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragId = useRef<string | null>(null)

  const visibleAreas = areas.filter((a) => !a.archived)
  const areaTables = tables.filter((t) => !t.archived && t.area_id === activeArea)
  // Tables with no position yet are auto-placed on a light grid so they're grabbable.
  const placed = areaTables.map((t, i) => ({
    ...t,
    x: t.pos_x ?? 0.12 + (i % 5) * 0.18,
    y: t.pos_y ?? 0.15 + Math.floor(i / 5) * 0.2,
  }))
  const sel = tables.find((t) => t.id === selected) ?? null

  // ── Area ops ──────────────────────────────────────────────────────────────
  function addArea() {
    const a: Area = { id: tmp(), name: `Area ${visibleAreas.length + 1}`, sort: areas.length, archived: false }
    setAreas((list) => [...list, a])
    setActiveArea(a.id)
  }
  function renameArea(id: string, name: string) {
    setAreas((list) => list.map((a) => (a.id === id ? { ...a, name } : a)))
  }
  function archiveArea(id: string) {
    if (tables.some((t) => t.area_id === id && !t.archived)) {
      toast('Move or remove this area’s tables first.', 'error')
      return
    }
    setAreas((list) => list.map((a) => (a.id === id ? { ...a, archived: true } : a)))
    const next = visibleAreas.find((a) => a.id !== id)
    if (next) setActiveArea(next.id)
  }

  // ── Table ops ─────────────────────────────────────────────────────────────
  function addTable() {
    if (!activeArea) return
    const label = String(tables.filter((t) => !t.archived).length + 1)
    const t: LayoutTable = { id: tmp(), label, capacity: 4, shape: 'square', area_id: activeArea, pos_x: 0.15, pos_y: 0.15, archived: false }
    setTables((list) => [...list, t])
    setSelected(t.id)
  }
  function patchTable(id: string, patch: Partial<LayoutTable>) {
    setTables((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }
  function archiveTable(id: string) {
    setTables((list) => list.map((t) => (t.id === id ? { ...t, archived: true } : t)))
    setSelected(null)
  }

  // ── Drag (normalised 0..1 of the canvas — resolution-independent) ─────────
  function onPointerDown(e: React.PointerEvent, id: string) {
    if (!editing) return
    setSelected(id)
    dragId.current = id
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!editing || !dragId.current || !canvasRef.current) return
    const r = canvasRef.current.getBoundingClientRect()
    const x = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width))
    const y = Math.min(0.94, Math.max(0.04, (e.clientY - r.top) / r.height))
    patchTable(dragId.current, { pos_x: Number(x.toFixed(4)), pos_y: Number(y.toFixed(4)) })
  }
  function onPointerUp() {
    dragId.current = null
  }

  // ── Save & Lock ───────────────────────────────────────────────────────────
  async function save() {
    setSaving(true)
    const payloadAreas = areas.map((a) => ({ id: isNew(a.id) ? null : a.id, name: a.name, sort: a.sort, archived: a.archived }))
    const payloadTables = tables.map((t) => ({
      id: isNew(t.id) ? null : t.id,
      label: t.label,
      capacity: t.capacity ?? null,
      shape: t.shape,
      // A table assigned to a brand-new area can't reference a tmp id — the RPC
      // resolves areas first, but tmp ids aren't real UUIDs, so send null and
      // let the owner re-open to place them once the area has a real id.
      area_id: t.area_id && !isNew(t.area_id) ? t.area_id : null,
      pos_x: t.pos_x,
      pos_y: t.pos_y,
      archived: t.archived,
    }))
    const { error } = await supabase.rpc('save_floor_layout', { p_cafe_id: cafeId, p_areas: payloadAreas, p_tables: payloadTables })
    setSaving(false)
    if (error) return toast(error.message, 'error')
    toast('Layout saved & locked.')
    setEditing(false)
    setSelected(null)
    router.refresh()
  }

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Floor &amp; table setup</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Arrange tables to match your real layout. {editing ? 'Drag tables to position them.' : 'Locked — staff can’t move tables during service.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={() => { setEditing(false); setSelected(null); router.refresh() }} className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-[13px] font-medium text-foreground hover:bg-surface-subtle">Cancel</button>
              <button onClick={save} disabled={saving} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50">{saving ? 'Saving…' : 'Save & lock layout'}</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover"><Pencil size={15} /> Edit layout</button>
          )}
        </div>
      </div>

      {/* Area tabs */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {visibleAreas.map((a) => (
          <div key={a.id} className={`flex items-center rounded-full border ${activeArea === a.id ? 'border-primary bg-primary-subtle' : 'border-border-strong'}`}>
            {editing ? (
              <input value={a.name} onChange={(e) => renameArea(a.id, e.target.value)} onFocus={() => setActiveArea(a.id)}
                className="w-28 bg-transparent px-3 py-1.5 text-[13px] font-medium text-foreground outline-none" />
            ) : (
              <button onClick={() => setActiveArea(a.id)} className={`px-4 py-1.5 text-[13px] font-medium ${activeArea === a.id ? 'text-primary' : 'text-muted-foreground'}`}>{a.name}</button>
            )}
            {editing && visibleAreas.length > 1 && (
              <button onClick={() => archiveArea(a.id)} aria-label="Remove area" className="pr-2 text-muted-foreground hover:text-destructive"><X size={13} /></button>
            )}
          </div>
        ))}
        {editing && (
          <button onClick={addArea} className="flex items-center gap-1 rounded-full border border-dashed border-border-strong px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-surface-subtle"><Plus size={14} /> Add area</button>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* Canvas */}
        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative aspect-[16/10] w-full touch-none overflow-hidden rounded-xl border border-border bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,var(--color-border)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,var(--color-border)_24px)] bg-surface"
        >
          {!editing && placed.length === 0 && (
            <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">No tables here yet. Tap “Edit layout” to add and arrange them.</p>
          )}
          {placed.map((t) => {
            const isSel = selected === t.id
            const size = t.shape === 'rectangle' ? 'h-12 w-20' : t.shape === 'round' ? 'h-16 w-16 rounded-full' : 'h-14 w-14'
            return (
              <button
                key={t.id}
                onPointerDown={(e) => onPointerDown(e, t.id)}
                onClick={() => setSelected(t.id)}
                style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center border-2 bg-surface text-center shadow-[var(--shadow-sm)] ${size} ${t.shape !== 'round' ? 'rounded-[var(--radius)]' : ''} ${isSel ? 'border-primary' : 'border-border-strong'} ${editing ? 'cursor-move touch-none' : 'cursor-pointer'}`}
              >
                <span className="text-[13px] font-semibold leading-none text-foreground">{t.label}</span>
                {t.capacity != null && <span className="mt-0.5 text-[10px] leading-none text-muted-foreground">{t.capacity}</span>}
              </button>
            )
          })}
        </div>

        {/* Inspector */}
        <div className="space-y-3">
          {editing && (
            <button onClick={addTable} disabled={!activeArea} className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] border border-dashed border-border-strong py-2.5 text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40"><Plus size={15} /> Add table</button>
          )}
          {editing && sel && !sel.archived ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-foreground">Table {sel.label}</p>
                <button onClick={() => archiveTable(sel.id)} className="text-muted-foreground hover:text-destructive" aria-label="Remove table"><Trash2 size={15} /></button>
              </div>
              <label className="mt-3 block text-[12px] font-medium text-muted-foreground">Label</label>
              <input value={sel.label} onChange={(e) => patchTable(sel.id, { label: e.target.value })} className="mt-1 h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-sm text-foreground" />
              <label className="mt-3 block text-[12px] font-medium text-muted-foreground">Seats</label>
              <input type="number" min={1} value={sel.capacity ?? ''} onChange={(e) => patchTable(sel.id, { capacity: e.target.value ? Number(e.target.value) : null })} className="mt-1 h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-sm text-foreground" />
              <label className="mt-3 block text-[12px] font-medium text-muted-foreground">Shape</label>
              <div className="mt-1 flex gap-1.5">
                {SHAPES.map((sh) => (
                  <button key={sh.key} onClick={() => patchTable(sel.id, { shape: sh.key })} className={`flex flex-1 flex-col items-center gap-1 rounded-[var(--radius)] border py-2 text-[11px] ${sel.shape === sh.key ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}><sh.icon size={16} /></button>
                ))}
              </div>
              {visibleAreas.length > 1 && (
                <>
                  <label className="mt-3 block text-[12px] font-medium text-muted-foreground">Area</label>
                  <select value={sel.area_id ?? ''} onChange={(e) => patchTable(sel.id, { area_id: e.target.value || null })} className="mt-1 h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-sm text-foreground">
                    {visibleAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface-subtle p-4 text-[12.5px] text-muted-foreground">
              {editing ? 'Select a table to edit it, or add one.' : (
                <span className="flex items-center gap-1.5"><Lock size={13} /> Layout is locked. “Edit layout” to make changes.</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
