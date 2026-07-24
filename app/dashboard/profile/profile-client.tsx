'use client'

import { useMemo, useState } from 'react'
import {
  Building2, ShieldCheck, ReceiptText, CreditCard, QrCode, ChefHat, SlidersHorizontal,
  Check, Info, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { uploadCafeLogo } from '@/lib/image-upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { SectionNav, type SectionItem } from '@/components/ui/section-nav'
import { GstPanel } from './gst-panel'
import { PaymentsPanel } from './payments-panel'

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
  accept_cash: boolean
  accept_upi_counter: boolean
  accept_card_counter: boolean
  accept_pay_counter: boolean
  online_payments_enabled: boolean
  razorpay_status: 'not_connected' | 'pending' | 'connected' | 'disabled'
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

const SECTIONS: SectionItem[] = [
  { id: 'basic', label: 'Basic information', icon: <Building2 size={16} /> },
  { id: 'gst', label: 'Business & GST', icon: <ShieldCheck size={16} /> },
  { id: 'billing', label: 'Billing', icon: <ReceiptText size={16} /> },
  { id: 'payments', label: 'Payments', icon: <CreditCard size={16} /> },
  { id: 'branding', label: 'QR & branding', icon: <QrCode size={16} /> },
  { id: 'kitchen', label: 'Kitchen', icon: <ChefHat size={16} /> },
  { id: 'preferences', label: 'Preferences', icon: <SlidersHorizontal size={16} /> },
]

export default function ProfileClient({
  cafeId,
  userId,
  myRole,
  initial,
  initialHours,
  timezone,
}: {
  cafeId: string
  userId: string
  myRole: string
  initial: CafeProfile
  initialHours: Hours
  timezone: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [form, setForm] = useState(initial)
  const [hours, setHours] = useState(initialHours)
  // The saved baseline. Updated on a successful save so the page correctly
  // stops looking dirty; kept in state (not the mutable `initial` prop) so
  // the dirty comparison actually recomputes.
  const [baseline, setBaseline] = useState({ form: initial, hours: initialHours })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState('basic')
  const isAdmin = myRole === 'owner' || myRole === 'manager'
  const dis = !isAdmin

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline.form) || JSON.stringify(hours) !== JSON.stringify(baseline.hours),
    [form, hours, baseline],
  )

  const set = (k: keyof CafeProfile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const patch = (p: Partial<CafeProfile>) => setForm((f) => ({ ...f, ...p }))

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
    if (form.gst_registered) {
      if (!gstin) { setSection('gst'); return setError('A GSTIN is required for a GST-registered café. Choose "Not registered" if you are not.') }
      if (!GSTIN_RE.test(gstin)) { setSection('gst'); return setError('GSTIN format looks invalid (e.g. 06AABCB1234F1Z5). Format check only — it does not verify official registration.') }
      if (!form.legal_name.trim()) { setSection('gst'); return setError('Legal business name is required on a GST tax invoice.') }
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
      accept_cash: form.accept_cash,
      accept_upi_counter: form.accept_upi_counter,
      accept_card_counter: form.accept_card_counter,
      accept_pay_counter: form.accept_pay_counter,
      online_payments_enabled: form.online_payments_enabled,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      pincode: form.pincode.trim() || null,
      dine_in: form.dine_in,
      takeaway: form.takeaway,
    }

    const { error: cafeErr } = await supabase.from('cafes').update(cafeUpdate).eq('id', cafeId)
    if (cafeErr) { setBusy(false); return setError(cafeErr.message) }

    const { error: settingsErr } = await supabase
      .from('cafe_settings')
      .upsert({ cafe_id: cafeId, hours, receipt: { footer: form.receipt_footer.trim() } })
    if (settingsErr) { setBusy(false); return setError(settingsErr.message) }

    // Audit trail: one row per materially changed field, compared to the last
    // saved baseline (no-op if nothing changed since the last save).
    const audit: { field: string; from: unknown; to: unknown }[] = []
    const watch: (keyof CafeProfile)[] = ['name', 'gstin', 'gst_sac_code', 'gst_registered', 'legal_name', 'tax_inclusive', 'logo_url', 'tax_percent', 'service_charge', 'dine_in', 'takeaway']
    for (const k of watch) {
      if (String(baseline.form[k] ?? '') !== String(form[k] ?? '')) audit.push({ field: k, from: baseline.form[k], to: form[k] })
    }
    if (JSON.stringify(baseline.hours) !== JSON.stringify(hours)) audit.push({ field: 'hours', from: null, to: null })
    if (audit.length) {
      await supabase.from('audit_logs').insert(
        audit.map((a) => ({ cafe_id: cafeId, actor_id: userId, action: `profile.${a.field}.changed`, entity: 'cafes', meta: { from: a.from, to: a.to } })),
      )
    }

    // New baseline → the page correctly stops looking dirty.
    setBaseline({ form: { ...form }, hours: { ...hours } })
    setBusy(false)
    toast('Café profile saved.')
  }

  const saveBtn = isAdmin && (
    <Button onClick={save} loading={busy} disabled={!dirty && !busy}>
      {dirty ? 'Save changes' : 'Saved'}
    </Button>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 lg:py-8 lg:pb-8">
      <PageHeader
        title="Café profile"
        subtitle="Manage the information customers see on your menu, bills and receipts."
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">
            <ShieldCheck size={12} /> Verified
          </span>
        }
        actions={<div className="hidden lg:block">{saveBtn}</div>}
      />

      {!isAdmin && (
        <p className="mt-4 rounded-[var(--radius)] bg-warning-subtle px-3 py-2.5 text-[13px] text-warning">
          View only — your role ({myRole}) can’t edit the café profile.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[224px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <SectionNav items={SECTIONS} active={section} onChange={setSection} />
          <div className="mt-4 hidden rounded-[var(--radius-lg)] border border-border bg-surface p-4 lg:block">
            <p className="text-[13px] font-medium text-foreground">Need help?</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              These details flow straight to your QR menu and bills. Changes apply to future orders only.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {error && (
            <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2.5 text-[13px] text-destructive">{error}</p>
          )}

          {section === 'basic' && (
            <Card>
              <CardHeader title="Basic information" description="Your café’s identity on the menu and every bill." />
              <div className="mt-5 flex items-center gap-4">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo_url} alt="" className="h-16 w-16 rounded-[var(--radius)] border border-border object-cover" />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-[var(--radius)] bg-primary-subtle text-2xl font-semibold text-primary">
                    {form.name.charAt(0).toUpperCase() || 'C'}
                  </div>
                )}
                <div>
                  <p className="text-[13.5px] font-medium text-foreground">Café logo</p>
                  <p className="text-[12px] text-muted-foreground">Appears on your QR menu and bills. PNG or JPG.</p>
                  {isAdmin && (
                    <div className="mt-2 flex items-center gap-2">
                      <label className="inline-flex min-h-9 cursor-pointer items-center rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">
                        {uploading ? 'Uploading…' : form.logo_url ? 'Change logo' : 'Upload logo'}
                        <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => pickLogo(e.target.files?.[0])} />
                      </label>
                      {form.logo_url && (
                        <button type="button" onClick={() => patch({ logo_url: null })} className="min-h-9 px-2 text-[12.5px] font-medium text-muted-foreground hover:text-destructive">
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <Input label="Café name" value={form.name} onChange={set('name')} disabled={dis} />
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-foreground">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => patch({ description: e.target.value })}
                    rows={2}
                    disabled={dis}
                    placeholder="A cozy café serving the best coffee and snacks."
                    className="w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Business email" type="email" value={form.email} onChange={set('email')} disabled={dis} />
                  <Input label="Business phone" type="tel" value={form.phone} onChange={set('phone')} disabled={dis} />
                </div>
                <Input label="Website" placeholder="https://…" value={form.website} onChange={set('website')} disabled={dis} />

                <div className="border-t border-border pt-4">
                  <Input label="Address line 1" value={form.address} onChange={set('address')} disabled={dis} />
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <Input label="City" value={form.city} onChange={set('city')} disabled={dis} />
                    <Input label="State" value={form.state} onChange={set('state')} disabled={dis} />
                    <Input label="PIN code" inputMode="numeric" value={form.pincode} onChange={set('pincode')} disabled={dis} />
                  </div>
                  <div className="mt-4">
                    <Input label="Timezone" value={timezone} disabled hint="Bills and daily totals use this zone. Contact support to change it." />
                  </div>
                </div>
              </div>
            </Card>
          )}

          {section === 'gst' && (
            <GstPanel value={form} onChange={patch} disabled={dis} />
          )}

          {section === 'billing' && (
            <Card>
              <CardHeader title="Billing" description="How your bills read. KhaoPiyo is digital-first — printing is never required." />
              <div className="mt-5 space-y-4">
                <Input label="Receipt footer" placeholder="Thank you for visiting!" value={form.receipt_footer} onChange={set('receipt_footer')} disabled={dis}
                  hint="Shown at the bottom of every digital bill." />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Invoice prefix" value={form.invoice_prefix} onChange={set('invoice_prefix')} disabled={dis || !form.gst_registered}
                    hint={form.gst_registered ? 'Invoices number as PREFIX/26-27/00001.' : 'Enable GST to issue numbered invoices.'} />
                </div>
                <div className="flex items-start gap-2 rounded-[var(--radius)] bg-info-subtle px-3 py-2.5 text-[12.5px] text-info">
                  <Info size={15} className="mt-0.5 shrink-0" />
                  <span>Every finalised bill is kept as a permanent record and shown under <Link href="/dashboard/bills" className="font-medium underline">Bills</Link>. Nothing is ever deleted.</span>
                </div>
              </div>
            </Card>
          )}

          {section === 'payments' && (
            <PaymentsPanel value={form} onChange={patch} disabled={dis} />
          )}

          {section === 'branding' && (
            <Card>
              <CardHeader title="QR & branding" description="Your logo and colours flow onto the customer-facing QR menu." />
              <div className="mt-5 flex flex-wrap items-center gap-4">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo_url} alt="" className="h-14 w-14 rounded-[var(--radius)] border border-border object-cover" />
                ) : (
                  <div className="grid h-14 w-14 place-items-center rounded-[var(--radius)] bg-primary-subtle text-xl font-semibold text-primary">
                    {form.name.charAt(0).toUpperCase() || 'C'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-foreground">{form.name || 'Your café'}</p>
                  <p className="text-[12px] text-muted-foreground">Logo set under Basic information.</p>
                </div>
              </div>
              <Link href="/dashboard/tables/manage" className="mt-5 inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-medium text-foreground hover:bg-surface-subtle">
                <QrCode size={15} /> Manage table QR codes <ExternalLink size={13} className="text-muted-foreground" />
              </Link>
            </Card>
          )}

          {section === 'kitchen' && (
            <Card>
              <CardHeader title="Kitchen" description="How orders reach the kitchen." />
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-4 py-3">
                  <div>
                    <p className="text-[13.5px] font-medium text-foreground">Digital KDS</p>
                    <p className="text-[12px] text-muted-foreground">Always on — the kitchen screen is the source of truth.</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success"><Check size={12} /> Active</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-4 py-3">
                  <div>
                    <p className="text-[13.5px] font-medium text-foreground">KOT printing</p>
                    <p className="text-[12px] text-muted-foreground">Optional. Configure printers and stations in Settings.</p>
                  </div>
                  <Link href="/dashboard/settings" className="text-[12.5px] font-medium text-primary hover:underline">Open Settings</Link>
                </div>
              </div>
            </Card>
          )}

          {section === 'preferences' && (
            <>
              <Card>
                <CardHeader title="Ordering" description="Which order types this café accepts." />
                <div className="mt-5 flex flex-wrap gap-3">
                  {([['dine_in', 'Dine-in'], ['takeaway', 'Takeaway']] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      disabled={dis}
                      onClick={() => patch({ [k]: !form[k] } as Partial<CafeProfile>)}
                      className={`inline-flex min-h-10 items-center gap-2 rounded-[var(--radius)] border px-4 text-[13px] font-medium disabled:opacity-60 ${
                        form[k] ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
                      }`}
                    >
                      {form[k] && <Check size={14} />} {label}
                    </button>
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Operating hours" description="Shown on your public menu." />
                <div className="mt-5 space-y-2">
                  {DAYS.map(([key, label]) => {
                    const d = hours[key] ?? { open: '09:00', close: '23:00', closed: false }
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex w-32 items-center gap-2 text-[13px] text-foreground">
                          <input type="checkbox" checked={!d.closed} disabled={dis}
                            onChange={(e) => setHours((h) => ({ ...h, [key]: { ...d, closed: !e.target.checked } }))} />
                          {label}
                        </label>
                        {!d.closed ? (
                          <>
                            <input type="time" value={d.open} disabled={dis}
                              onChange={(e) => setHours((h) => ({ ...h, [key]: { ...d, open: e.target.value } }))}
                              className="min-h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
                            <span className="text-muted-foreground">–</span>
                            <input type="time" value={d.close} disabled={dis}
                              onChange={(e) => setHours((h) => ({ ...h, [key]: { ...d, close: e.target.value } }))}
                              className="min-h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
                          </>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">Closed</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Mobile sticky save bar — only when there is something to save. */}
      {isAdmin && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
          <Button onClick={save} loading={busy} className="w-full">Save changes</Button>
        </div>
      )}
    </div>
  )
}
