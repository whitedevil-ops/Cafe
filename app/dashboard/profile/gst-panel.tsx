'use client'

import { Input } from '@/components/ui/input'

export type GstConfig = {
  gst_registered: boolean
  legal_name: string
  trade_name: string
  gstin: string
  state_code: string
  invoice_prefix: string
  gst_sac_code: string
  tax_percent: number
  tax_inclusive: boolean
  service_charge: number
}

// Same format check the database enforces (is_valid_gstin, 0037). Duplicated
// here only to give immediate feedback — the server remains authoritative.
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export function GstPanel({
  value,
  onChange,
  disabled,
}: {
  value: GstConfig
  onChange: (patch: Partial<GstConfig>) => void
  disabled: boolean
}) {
  const gstinTouched = value.gstin.trim().length > 0
  const gstinValid = GSTIN_RE.test(value.gstin.trim().toUpperCase())

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium text-foreground">Business &amp; GST</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Controls what appears on every customer bill, and how tax is calculated on every order.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { v: true, label: 'GST registered' },
          { v: false, label: 'Not registered' },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ gst_registered: o.v })}
            className={`min-h-10 rounded-[var(--radius)] border px-4 text-[13px] font-medium disabled:opacity-60 ${
              value.gst_registered === o.v
                ? 'border-primary bg-primary-subtle text-primary'
                : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {!value.gst_registered ? (
        <p className="mt-4 rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5 text-[12.5px] text-muted-foreground">
          No GST is charged and no GST fields appear on bills. Customers get a plain receipt.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Legal business name *"
              value={value.legal_name}
              onChange={(e) => onChange({ legal_name: e.target.value })}
              disabled={disabled}
              hint="The name registered against your GSTIN."
            />
            <Input
              label="Trade name"
              value={value.trade_name}
              onChange={(e) => onChange({ trade_name: e.target.value })}
              disabled={disabled}
              hint="If customers know you by a different name."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="GSTIN *"
              placeholder="06AABCB1234F1Z5"
              value={value.gstin}
              onChange={(e) => onChange({ gstin: e.target.value.toUpperCase() })}
              disabled={disabled}
              error={gstinTouched && !gstinValid ? 'That does not look like a valid GSTIN.' : undefined}
              hint={!gstinTouched ? 'Required to issue tax invoices.' : gstinValid ? 'Format looks correct.' : undefined}
            />
            <Input
              label="State code"
              placeholder="06"
              value={value.state_code}
              onChange={(e) => onChange({ state_code: e.target.value })}
              disabled={disabled}
              hint="First two digits of your GSTIN. Sets place of supply."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Invoice prefix"
              placeholder="INV"
              value={value.invoice_prefix}
              onChange={(e) => onChange({ invoice_prefix: e.target.value })}
              disabled={disabled}
              hint="Invoices number as PREFIX/26-27/00001."
            />
            <Input
              label="Default HSN/SAC"
              placeholder="996331"
              value={value.gst_sac_code}
              onChange={(e) => onChange({ gst_sac_code: e.target.value })}
              disabled={disabled}
              hint="996331 = restaurant service. Individual items can override this."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Default GST rate (%)"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={String(value.tax_percent)}
              onChange={(e) => onChange({ tax_percent: Number(e.target.value) })}
              disabled={disabled}
              hint="Used for any item without its own rate."
            />
            <Input
              label="Service charge (%)"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={String(value.service_charge)}
              onChange={(e) => onChange({ service_charge: Number(e.target.value) })}
              disabled={disabled}
              hint="Charged on the discounted amount. GST is not applied to it."
            />
          </div>

          <div>
            <p className="text-[13px] font-medium text-foreground">Menu pricing</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { v: false, label: 'Tax exclusive', sub: 'GST added on top of the menu price' },
                { v: true, label: 'Tax inclusive', sub: 'Menu price already includes GST' },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ tax_inclusive: o.v })}
                  className={`min-h-10 flex-1 rounded-[var(--radius)] border px-3 py-2 text-left disabled:opacity-60 ${
                    value.tax_inclusive === o.v
                      ? 'border-primary bg-primary-subtle'
                      : 'border-border-strong hover:bg-surface-subtle'
                  }`}
                >
                  <span className={`block text-[13px] font-medium ${value.tax_inclusive === o.v ? 'text-primary' : 'text-foreground'}`}>
                    {o.label}
                  </span>
                  <span className="block text-[11.5px] text-muted-foreground">{o.sub}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              This changes what a guest pays for a ₹100 item — ₹100 inclusive, or ₹100 plus GST exclusive.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
