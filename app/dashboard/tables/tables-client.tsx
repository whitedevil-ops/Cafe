'use client'

import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type TableRow = {
  id: string
  label: string
  capacity: number | null
  status: 'available' | 'occupied' | 'reserved' | 'cleaning'
  token: string
}

function makeToken(slug: string) {
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`
}

export default function TablesClient({
  cafeId,
  slug,
  initialTables,
}: {
  cafeId: string
  slug: string
  initialTables: TableRow[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [tables, setTables] = useState(initialTables)
  const [origin, setOrigin] = useState('')
  const [qr, setQr] = useState<Record<string, string>>({})
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<TableRow | null>(null)

  useEffect(() => setOrigin(window.location.origin), [])

  // Generate a QR data URL per table once we know the origin.
  useEffect(() => {
    if (!origin) return
    let alive = true
    ;(async () => {
      const next: Record<string, string> = {}
      for (const t of tables) {
        next[t.token] = await QRCode.toDataURL(`${origin}/t/${t.token}`, {
          margin: 1,
          width: 320,
          color: { dark: '#1C1917', light: '#FFFFFF' },
        })
      }
      if (alive) setQr(next)
    })()
    return () => {
      alive = false
    }
  }, [origin, tables])

  const urlFor = (token: string) => `${origin}/t/${token}`

  // Natural sort so "2" comes before "10" (and named tables still sort sensibly).
  const sorted = useMemo(
    () => [...tables].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [tables],
  )

  async function addTable() {
    const label = newLabel.trim()
    if (!label) {
      setError('Type a table name or number first — e.g. 13 or Patio.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('cafe_tables')
      .insert({ cafe_id: cafeId, label, token: makeToken(slug) })
      .select('id, label, capacity, status, token')
      .single()
    setBusy(false)
    if (error) return setError(error.message)
    setTables((t) => [...t, data as TableRow])
    setNewLabel('')
  }

  async function deleteTable(t: TableRow) {
    if (!confirm(`Delete table ${t.label}? Its QR code will stop working.`)) return
    const { error } = await supabase.from('cafe_tables').delete().eq('id', t.id)
    if (error) return setError(error.message)
    setTables((list) => list.filter((x) => x.id !== t.id))
  }

  function download(t: TableRow) {
    const data = qr[t.token]
    if (!data) return
    const a = document.createElement('a')
    a.href = data
    a.download = `${slug}-table-${t.label}.png`
    a.click()
  }

  async function copyLink(t: TableRow) {
    try {
      await navigator.clipboard.writeText(urlFor(t.token))
    } catch {}
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tables &amp; QR</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tables.length} table{tables.length === 1 ? '' : 's'} · print a QR for each and place it on the table.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-36">
            <Input
              label="New table"
              placeholder="e.g. 7 or Patio"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTable()}
            />
          </div>
          <Button onClick={addTable} loading={busy}>Add</Button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>
      )}

      {tables.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">No tables yet. Add your first one above.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((t) => (
            <div key={t.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">Table {t.label}</span>
                <button onClick={() => deleteTable(t)} aria-label={`Delete table ${t.label}`} className="min-h-11 px-2 text-[13px] text-muted-foreground hover:text-destructive">Delete</button>
              </div>
              <button
                onClick={() => setZoom(t)}
                className="mt-3 grid w-full place-items-center rounded-lg border border-border bg-white p-3"
                aria-label={`Enlarge QR for table ${t.label}`}
              >
                {qr[t.token] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr[t.token]} alt={`QR code for table ${t.label}`} className="h-40 w-40" />
                ) : (
                  <div className="h-40 w-40 animate-pulse rounded bg-surface-subtle" />
                )}
              </button>
              <p className="mt-2 truncate text-[12px] text-muted-foreground">{urlFor(t.token)}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => download(t)} className="flex-1">Download</Button>
                <Button variant="secondary" size="sm" onClick={() => copyLink(t)} className="flex-1">Copy link</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Zoom / print modal */}
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setZoom(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-surface p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg font-semibold text-foreground">Table {zoom.label}</p>
            <div className="mt-4 grid place-items-center rounded-lg border border-border bg-white p-4">
              {qr[zoom.token] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr[zoom.token]} alt={`QR code for table ${zoom.label}`} className="h-56 w-56" />
              )}
            </div>
            <p className="mt-3 break-all text-[12px] text-muted-foreground">{urlFor(zoom.token)}</p>
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" onClick={() => download(zoom)} className="flex-1">Download</Button>
              <Button onClick={() => setZoom(null)} className="flex-1">Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
