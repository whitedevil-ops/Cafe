'use client'

import { useEffect, useMemo, useState } from 'react'
import { copyText } from '@/lib/desktop-open'
import { savedFileHint } from '@/lib/is-desktop'
import QRCode from 'qrcode'
import { createClient } from '@/utils/supabase/client'
import { byTableLabel } from '@/lib/table-sort'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'

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
  const { toast } = useToast()
  const confirm = useConfirm()
  const [tables, setTables] = useState(initialTables)
  const [origin, setOrigin] = useState('')
  const [qr, setQr] = useState<Record<string, string>>({})
  const [newLabel, setNewLabel] = useState('')
  const [newSeats, setNewSeats] = useState('')
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
    () => [...tables].sort(byTableLabel),
    [tables],
  )

  async function addTable() {
    const label = newLabel.trim()
    if (!label) {
      setError('Type a table name or number first — e.g. 13 or Patio.')
      return
    }
    const seats = newSeats.trim()
    if (seats && (!/^\d+$/.test(seats) || Number(seats) < 1 || Number(seats) > 50)) {
      setError('Seats must be a number between 1 and 50, or left blank.')
      return
    }
    setBusy(true)
    setError(null)
    // The insert still writes the token normally — INSERT needs no SELECT
    // privilege on a column. What it can no longer do is read it straight back
    // in the same statement, because migration 0132 revokes select(token) from
    // `authenticated`. So: insert without a returning-select, then re-list
    // through the member-gated RPC to pick up the new row with its token.
    const { error } = await supabase
      .from('cafe_tables')
      .insert({ cafe_id: cafeId, label, capacity: seats ? Number(seats) : null, token: makeToken(slug) })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }

    const { data: fresh, error: listErr } = await supabase.rpc('list_cafe_tables_with_tokens', {
      p_cafe_id: cafeId,
    })
    setBusy(false)
    if (listErr) return setError(listErr.message)
    setTables((fresh ?? []) as TableRow[])
    setNewLabel('')
    setNewSeats('')
  }

  async function deleteTable(t: TableRow) {
    const ok = await confirm({
      title: `Delete table ${t.label}?`,
      description: 'Its QR code stops working immediately — any printed copy becomes useless.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase.from('cafe_tables').delete().eq('id', t.id)
    if (error) return setError(error.message)
    setTables((list) => list.filter((x) => x.id !== t.id))
    toast(`Table ${t.label} deleted.`)
  }

  // Two things were wrong here, and together they read as "downloading a QR
  // does nothing in the app":
  //
  //  1. No feedback at all — no toast on success, none on failure. Every other
  //     export in the dashboard goes through useFileExport and confirms the
  //     save, precisely because the desktop webview draws no download bar of
  //     its own (see lib/is-desktop.ts). This one never did.
  //  2. It downloaded straight from a data: URL. Chromium restricts what it
  //     will save from one, and the webview is stricter than the browser —
  //     which is why this could work on the website and quietly not in the
  //     .exe. A blob: object URL from a real anchor in the document is the
  //     path that works in both.
  function download(t: TableRow) {
    const data = qr[t.token]
    if (!data) return toast('That QR code has not finished generating yet.', 'error')
    const filename = `${slug}-table-${t.label}.png`
    try {
      // data:image/png;base64,xxxx -> bytes
      const base64 = data.slice(data.indexOf(',') + 1)
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      // In the document, not detached: a click on an unattached anchor is not
      // guaranteed to start a download in every engine.
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast(savedFileHint(filename))
    } catch {
      toast('Could not save the QR code. Right-click the image above and save it instead.', 'error')
    }
  }

  async function copyLink(t: TableRow) {
    const ok = await copyText(urlFor(t.token))
    toast(
      ok ? `${t.label} link copied.` : 'Could not copy the link. Open the QR page and copy it from the address bar.',
      ok ? 'success' : 'error',
    )
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
          <div className="w-24">
            <Input
              label="Seats"
              placeholder="Optional"
              inputMode="numeric"
              value={newSeats}
              onChange={(e) => setNewSeats(e.target.value)}
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
                <span className="font-medium text-foreground">
                  Table {t.label}
                  {t.capacity != null && <span className="ml-1.5 font-normal text-muted-foreground">· {t.capacity} seat{t.capacity === 1 ? '' : 's'}</span>}
                </span>
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
