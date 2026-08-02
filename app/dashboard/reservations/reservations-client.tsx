'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Phone } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { formatDateTime, businessDayStartISO } from '@/lib/datetime'

export type Reservation = {
  id: string
  customer_name: string
  customer_phone: string | null
  party_size: number
  reserved_for: string
  table_id: string | null
  table_label: string | null
  notes: string | null
  status: string
  created_at: string
}
export type TableOption = { id: string; label: string }

const STATUS_LABEL: Record<string, string> = {
  upcoming: 'Upcoming', seated: 'Seated', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
}
const STATUS_TONE: Record<string, string> = {
  upcoming: 'bg-primary-subtle text-primary',
  seated: 'bg-success-subtle text-success',
  completed: 'bg-surface-subtle text-muted-foreground',
  cancelled: 'bg-destructive-subtle text-destructive',
  no_show: 'bg-warning-subtle text-warning',
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ReservationsClient({
  cafeId,
  role,
  timezone,
  initialReservations,
  tables,
}: {
  cafeId: string
  role: string
  timezone: string
  initialReservations: Reservation[]
  tables: TableOption[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()
  const canManage = role === 'owner' || role === 'manager' || role === 'cashier' || role === 'waiter'

  const [reservations, setReservations] = useState(initialReservations)
  const [range, setRange] = useState<'today' | '7d' | '30d'>('30d')
  const [loading, setLoading] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [when, setWhen] = useState(() => {
    const d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return toLocalInputValue(d)
  })
  const [tableId, setTableId] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function reload(next: typeof range) {
    setRange(next)
    setLoading(true)
    const from = businessDayStartISO(timezone)
    const days = next === 'today' ? 1 : next === '7d' ? 7 : 30
    const to = new Date(new Date(from).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase.rpc('list_reservations', { p_cafe_id: cafeId, p_from: from, p_to: to })
    setReservations((data ?? []) as Reservation[])
    setLoading(false)
  }

  async function createReservation() {
    if (!name.trim()) return setCreateError('Enter the customer’s name.')
    const size = Math.round(Number(partySize))
    if (!size || size <= 0) return setCreateError('Party size must be greater than zero.')
    if (!when) return setCreateError('Pick a date and time.')
    setCreating(true)
    setCreateError(null)
    const { error } = await supabase.rpc('create_reservation', {
      p_cafe_id: cafeId,
      p_customer_name: name.trim(),
      p_customer_phone: phone.trim() || null,
      p_party_size: size,
      p_reserved_for: new Date(when).toISOString(),
      p_table_id: tableId || null,
      p_notes: notes.trim() || null,
    })
    setCreating(false)
    if (error) return setCreateError(error.message)
    toast(`Reservation added for ${name.trim()}.`)
    setName(''); setPhone(''); setPartySize('2'); setNotes(''); setTableId('')
    void reload(range)
  }

  async function setStatus(r: Reservation, status: string) {
    const destructive = status === 'cancelled' || status === 'no_show'
    let reason: string | undefined
    if (destructive) {
      const ok = await confirm({
        title: `${STATUS_LABEL[status]} this reservation?`,
        description: `${r.customer_name}'s reservation (${r.party_size} ${r.party_size === 1 ? 'guest' : 'guests'}) will be marked ${STATUS_LABEL[status].toLowerCase()}.`,
        confirmLabel: STATUS_LABEL[status],
        destructive: true,
      })
      if (!ok) return
      reason = window.prompt('Reason (optional):') ?? undefined
    }
    setReservations((list) => list.map((x) => (x.id === r.id ? { ...x, status } : x)))
    const { error } = await supabase.rpc('set_reservation_status', { p_reservation_id: r.id, p_status: status, p_reason: reason ?? null })
    if (error) {
      setReservations((list) => list.map((x) => (x.id === r.id ? { ...x, status: r.status } : x)))
      toast(error.message, 'error')
    } else {
      toast(`${r.customer_name} marked ${STATUS_LABEL[status].toLowerCase()}.`)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        title="Reservations"
        subtitle="A booking diary for walk-ins to come — log who's booked a table, then seat them when they arrive. Doesn't hold or block any table automatically."
      />

      {canManage && (
        <Card className="mt-6">
          <CardHeader title="New reservation" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="Customer name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vineet Sharma" />
            <Input label="Phone (optional)" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="98765 43210" />
            <Input label="Party size" type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} />
            <Input label="Date & time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-foreground">Table (optional)</span>
              <select
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
                className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[14px] text-foreground"
              >
                <option value="">No table picked yet</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
            <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Window seat, birthday" />
          </div>
          {createError && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{createError}</p>}
          <Button className="mt-4" loading={creating} onClick={createReservation}>Add reservation</Button>
        </Card>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          {reservations.length} reservation{reservations.length === 1 ? '' : 's'}
        </p>
        <div className="flex gap-1 rounded-[var(--radius)] bg-surface-subtle p-1">
          {([['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']] as const).map(([r, label]) => (
            <button
              key={r}
              onClick={() => reload(r)}
              className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium transition-colors ${
                range === r ? 'bg-surface text-foreground shadow-[var(--shadow-sm)]' : 'text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : reservations.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No reservations in this window.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {reservations.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={14} className="shrink-0 text-muted-foreground" />
                    <p className="text-[13.5px] font-medium text-foreground">{formatDateTime(r.reserved_for, timezone)}</p>
                  </div>
                  <p className="mt-1 text-[14px] font-semibold text-foreground">
                    {r.customer_name} <span className="font-normal text-muted-foreground">· {r.party_size} {r.party_size === 1 ? 'guest' : 'guests'}</span>
                  </p>
                  {r.customer_phone && (
                    <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground">
                      <Phone size={11} /> {r.customer_phone}
                    </p>
                  )}
                  {r.table_label && <p className="mt-0.5 text-[12.5px] text-muted-foreground">Table {r.table_label}</p>}
                  {r.notes && <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] text-muted-foreground">{r.notes}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${STATUS_TONE[r.status] ?? 'bg-surface-subtle text-muted-foreground'}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>

              {canManage && r.status === 'upcoming' && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" onClick={() => setStatus(r, 'seated')}>Seat now</Button>
                  <Button size="sm" variant="secondary" onClick={() => setStatus(r, 'no_show')}>No-show</Button>
                  <Button size="sm" variant="secondary" onClick={() => setStatus(r, 'cancelled')}>Cancel</Button>
                </div>
              )}
              {canManage && r.status === 'seated' && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" onClick={() => setStatus(r, 'completed')}>Mark completed</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
