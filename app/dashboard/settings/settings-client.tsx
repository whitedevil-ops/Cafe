'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Settings = {
  name: string
  upi_id: string
  upi_name: string
  upsell_threshold: number
}

export default function SettingsClient({
  cafeId,
  initial,
}: {
  cafeId: string
  initial: Settings
}) {
  const supabase = useMemo(() => createClient(), [])
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error } = await supabase
      .from('cafes')
      .update({
        name: form.name.trim() || initial.name,
        upi_id: form.upi_id.trim() || null,
        upi_name: form.upi_name.trim() || null,
        upsell_threshold: Math.max(0, Math.round(Number(form.upsell_threshold) || 0)),
      })
      .eq('id', cafeId)
    setBusy(false)
    if (error) return setError(error.message)
    setSaved(true)
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Café details and payments.</p>

      <div className="mt-8 space-y-4">
        <Input
          label="Café name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">UPI payments</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            When set, customers get a &ldquo;Pay by UPI&rdquo; button that opens their UPI app with
            the exact amount and order number prefilled. Staff confirm receipt on the kitchen
            screen. Leave blank to accept counter payments only.
          </p>
          <div className="mt-4 space-y-4">
            <Input
              label="UPI ID (VPA)"
              placeholder="yourcafe@okhdfcbank"
              value={form.upi_id}
              onChange={(e) => setForm({ ...form, upi_id: e.target.value })}
              hint="The UPI ID payments should go to — from your bank or payments app."
            />
            <Input
              label="Payee name"
              placeholder="Shown in the customer's UPI app"
              value={form.upi_name}
              onChange={(e) => setForm({ ...form, upi_name: e.target.value })}
            />
          </div>
        </div>

        <Input
          label="Upsell threshold (₹)"
          type="number"
          min={0}
          value={String(form.upsell_threshold)}
          onChange={(e) => setForm({ ...form, upsell_threshold: Number(e.target.value) })}
          hint="Cart value at which the add-on nudge appears on the QR menu."
        />

        {error && (
          <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>
        )}
        {saved && (
          <p className="rounded-[var(--radius)] bg-success-subtle px-3 py-2 text-[13px] text-success">Saved.</p>
        )}

        <Button onClick={save} loading={busy}>Save settings</Button>
      </div>
    </div>
  )
}
