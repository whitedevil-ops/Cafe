'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { uploadCafeLogo } from '@/lib/image-upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { GstPanel } from './gst-panel'

export type CafeProfile = {
  name: string
  description: string
  logo_url: string | null
  email: string
  phone: string
  website: string
  gstin: string
  gst_sac_code: string
  gst_registered: boolean
  legal_name: string
  trade_name: string
  state_code: string
  invoice_prefix: string
  tax_inclusive: boolean
  tax_percent: number
  service_charge: number
  address: string
  city: string
  state: string
  pincode: string
  dine_in: boolean
  takeaway: boolean
  receipt_footer: string
}

export type Hours = Record<string, { open: string; close: string; closed: boolean }>

const DAYS: [string, string][] = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
]

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export default function ProfileClient({
  cafeId,
  userId,
  myRole,
  initial,
  initialHours,
}: {
  cafeId: string
  userId: string
  myRole: string
  initial: CafeProfile
  initialHours: Hours
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [form, setForm] = useState(initial)
  const [hours, setHours] = useState(initialHours)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isAdmin = myRole === 'owner' || myRole === 'manager'

  const set = (k: keyof CafeProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function pickLogo(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    const result = await uploadCafeLogo(cafeId, file)
    setUploading(false)
    if ('error' in result) return setError(result.error)
    setForm((f) => ({ ...f, logo_url: result.url }))
  }

  async function save() {
    const gstin = form.gstin.trim().toUpperCase()
    // Only enforced when the café says it IS registered — an unregistered
    // café must not be blocked by a field that doesn't apply to it.
    if (form.gst_registered) {
      if (!gstin) {
        setError('A GSTIN is required for a GST-registered café. Choose "Not registered" if you are not.')
        return
      }
      if (!GSTIN_RE.test(gstin)) {
        setError('GSTIN format looks invalid (e.g. 06AABCB1234F1Z5). Format check only — it does not verify official registration.')
        return
      }
      if (!form.legal_name.trim()) {
        setError('Legal business name is required on a GST tax invoice.')
        return
      }
    }
    setBusy(true)
    setError(null)

    const cafeUpdate = {
      name: form.name.trim() || initial.name,
      description: form.description.trim() || null,
      logo_url: form.logo_url,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      gstin: gstin || null,
      gst_sac_code: form.gst_sac_code.trim() || '996331',
      gst_registered: form.gst_registered,
      legal_name: form.legal_name.trim() || null,
      trade_name: form.trade_name.trim() || null,
      state_code: form.state_code.trim() || (gstin ? gstin.slice(0, 2) : null),
      invoice_prefix: form.invoice_prefix.trim() || 'INV',
      tax_inclusive: form.tax_inclusive,
      tax_percent: Math.min(100, Math.max(0, Number(form.tax_percent) || 0)),
      service_charge: Math.min(100, Math.max(0, Number(form.service_charge) || 0)),
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      pincode: form.pincode.trim() || null,
      dine_in: form.dine_in,
      takeaway: form.takeaway,
    }

    const { error: cafeErr } = await supabase.from('cafes').update(cafeUpdate).eq('id', cafeId)
    if (cafeErr) {
      setBusy(false)
      return setError(cafeErr.message)
    }

    const { error: settingsErr } = await supabase
      .from('cafe_settings')
      .upsert({ cafe_id: cafeId, hours, receipt: { footer: form.receipt_footer.trim() } })
    if (settingsErr) {
      setBusy(false)
      return setError(settingsErr.message)
    }

    // Audit trail: one row per materially changed field (no-op if none changed).
    const audit: { field: string; from: unknown; to: unknown }[] = []
    const watch: (keyof CafeProfile)[] = ['name', 'gstin', 'gst_sac_code', 'logo_url', 'tax_percent', 'service_charge', 'dine_in', 'takeaway']
    for (const k of watch) {
      if (String(initial[k] ?? '') !== String(form[k] ?? '')) audit.push({ field: k, from: initial[k], to: form[k] })
    }
    if (JSON.stringify(initialHours) !== JSON.stringify(hours)) {
      audit.push({ field: 'hours', from: null, to: null })
    }
    if (audit.length) {
      await supabase.from('audit_logs').insert(
        audit.map((a) => ({
          cafe_id: cafeId,
          actor_id: userId,
          action: `profile.${a.field}.changed`,
          entity: 'cafes',
          meta: { from: a.from, to: a.to },
        })),
      )
    }

    setBusy(false)
    toast('Café profile saved.')
  }

  const dis = !isAdmin

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Café profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This information appears on your QR menu, bills, and receipts.
      </p>

      {!isAdmin && (
        <p className="mt-4 rounded-[var(--radius)] bg-warning-subtle px-3 py-2 text-[13px] text-warning">
          View only — your role ({myRole}) can&apos;t edit the café profile.
        </p>
      )}

      <div className="mt-8 space-y-5">
        {/* Basic */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-foreground">Basic information</h2>
          <div className="mt-4 flex items-center gap-4">
            {form.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logo_url} alt="" className="h-16 w-16 rounded-xl border border-border object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-xl bg-primary-subtle text-xl font-semibold text-primary">
                {form.name.charAt(0).toUpperCase() || 'C'}
              </div>
            )}
            {isAdmin && (
              <div className="space-y-1">
                <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius)] border border-border-strong px-3 text-[13px] text-foreground hover:bg-surface-subtle">
                  {uploading ? 'Uploading…' : form.logo_url ? 'Change logo' : 'Upload logo'}
                  <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => pickLogo(e.target.files?.[0])} />
                </label>
                {form.logo_url && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, logo_url: null }))} className="mt-1 min-h-11 px-1 text-[12px] text-muted-foreground hover:text-destructive">
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="mt-4 space-y-4">
            <Input label="Café name" value={form.name} onChange={set('name')} disabled={dis} />
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-foreground">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                disabled={dis}
                className="w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-60"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Business email" type="email" value={form.email} onChange={set('email')} disabled={dis} />
              <Input label="Business phone" type="tel" value={form.phone} onChange={set('phone')} disabled={dis} />
            </div>
            <Input label="Website" placeholder="https://…" value={form.website} onChange={set('website')} disabled={dis} />
          </div>
        </section>

        {/* Business & GST — its own section so tax config is discoverable
            instead of buried among unrelated profile fields. */}
        <GstPanel
          value={form}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          disabled={dis}
        />

        {/* Billing settings */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-foreground">Billing settings</h2>
          <div className="mt-4">
            <Input label="Receipt footer" placeholder="Thank you for visiting!" value={form.receipt_footer} onChange={set('receipt_footer')} disabled={dis} />
          </div>
        </section>

        {/* Address */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-foreground">Address</h2>
          <div className="mt-4 space-y-4">
            <Input label="Address" value={form.address} onChange={set('address')} disabled={dis} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="City" value={form.city} onChange={set('city')} disabled={dis} />
              <Input label="State" value={form.state} onChange={set('state')} disabled={dis} />
              <Input label="PIN code" inputMode="numeric" value={form.pincode} onChange={set('pincode')} disabled={dis} />
            </div>
          </div>
        </section>

        {/* Hours */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-foreground">Operating hours</h2>
          <div className="mt-4 space-y-2">
            {DAYS.map(([key, label]) => {
              const d = hours[key] ?? { open: '09:00', close: '23:00', closed: false }
              return (
                <div key={key} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-24 text-foreground">{label}</span>
                  <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <input type="checkbox" checked={!d.closed} disabled={dis}
                      onChange={(e) => setHours((h) => ({ ...h, [key]: { ...d, closed: !e.target.checked } }))} />
                    Open
                  </label>
                  {!d.closed && (
                    <>
                      <input type="time" value={d.open} disabled={dis}
                        onChange={(e) => setHours((h) => ({ ...h, [key]: { ...d, open: e.target.value } }))}
                        className="min-h-11 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
                      <span className="text-muted-foreground">–</span>
                      <input type="time" value={d.close} disabled={dis}
                        onChange={(e) => setHours((h) => ({ ...h, [key]: { ...d, close: e.target.value } }))}
                        className="min-h-11 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
                    </>
                  )}
                  {d.closed && <span className="text-[13px] text-muted-foreground">Closed</span>}
                </div>
              )
            })}
          </div>
        </section>

        {/* Ordering */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-foreground">Ordering</h2>
          <div className="mt-4 flex flex-wrap gap-6 text-sm text-foreground">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.dine_in} disabled={dis}
                onChange={(e) => setForm((f) => ({ ...f, dine_in: e.target.checked }))} />
              Dine-in
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.takeaway} disabled={dis}
                onChange={(e) => setForm((f) => ({ ...f, takeaway: e.target.checked }))} />
              Takeaway
            </label>
          </div>
        </section>

        {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

        {isAdmin && <Button onClick={save} loading={busy}>Save profile</Button>}
      </div>
    </div>
  )
}
