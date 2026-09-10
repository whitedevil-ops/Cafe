'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { InvoicePdfButton } from '@/components/ops/invoice-pdf-button'
import type { PlatformInvoice } from '@/lib/invoice-pdf-export'

// Manual invoice generation (2026-09-10) — Ventron currently takes payment
// for KhaoPiyo by personal UPI, outside any gateway, so this exists purely
// to give that money a paper trail. Every field below pre-fills from the
// café's own real record (op_get_invoice_prefill) and stays fully editable —
// the admin is the one who actually saw the UPI payment land, not the
// database, so nothing here is ever auto-marked paid.

type Prefill = {
  cafe_id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  billing_address: string | null
  billing_city: string | null
  billing_state: string | null
  billing_pincode: string | null
  billing_country: string
  gstin: string | null
  plan_key: string
  plan_name: string
  plan_price_monthly: number | null
  plan_price_yearly: number | null
  subscription_start: string | null
  subscription_end: string | null
}

type FormState = {
  customer_name: string
  customer_phone: string
  customer_email: string
  billing_address: string
  billing_city: string
  billing_state: string
  billing_pincode: string
  billing_country: string
  gstin: string
  plan_name: string
  subscription_start: string
  subscription_end: string
  amount: string
  discount: string
  tax: string
  payment_method: string
  payment_date: string
  payment_reference: string
  payment_status: 'pending' | 'paid' | 'partial' | 'failed'
  notes: string
}

const EMPTY_FORM: FormState = {
  customer_name: '', customer_phone: '', customer_email: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '', billing_country: 'India',
  gstin: '', plan_name: '', subscription_start: '', subscription_end: '',
  amount: '', discount: '0', tax: '0',
  payment_method: 'UPI', payment_date: '', payment_reference: '', payment_status: 'pending', notes: '',
}

/** iso timestamp or date -> yyyy-mm-dd for a date input; empty string if absent. */
function toDateInput(v: string | null): string {
  if (!v) return ''
  return v.slice(0, 10)
}

function field(label: string, value: string, onChange: (v: string) => void, opts?: { type?: string; placeholder?: string; className?: string }) {
  return (
    <label className={`block ${opts?.className ?? ''}`}>
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      <input
        type={opts?.type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={opts?.placeholder}
        className="mt-1 h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground"
      />
    </label>
  )
}

export function InvoiceGenerateModal({
  cafeId,
  cafeName,
  onClose,
  onGenerated,
}: {
  cafeId: string
  cafeName: string
  onClose: () => void
  onGenerated?: () => void
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // Not directly editable in the form (plan_name, which IS editable, is what
  // actually prints on the invoice) — kept alongside form state purely so
  // op_generate_invoice gets the café's real plan key rather than an empty
  // string.
  const [planKey, setPlanKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [generated, setGenerated] = useState<PlatformInvoice | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data, error: err } = await supabase.rpc('op_get_invoice_prefill', { p_cafe_id: cafeId })
      if (cancelled) return
      if (err || !data) {
        setError(err?.message ?? 'Could not load café details.')
        setLoading(false)
        return
      }
      const p = data as Prefill
      setPlanKey(p.plan_key ?? '')
      setForm({
        customer_name: p.customer_name ?? cafeName,
        customer_phone: p.customer_phone ?? '',
        customer_email: p.customer_email ?? '',
        billing_address: p.billing_address ?? '',
        billing_city: p.billing_city ?? '',
        billing_state: p.billing_state ?? '',
        billing_pincode: p.billing_pincode ?? '',
        billing_country: p.billing_country ?? 'India',
        gstin: p.gstin ?? '',
        plan_name: p.plan_name ?? '',
        subscription_start: toDateInput(p.subscription_start),
        subscription_end: toDateInput(p.subscription_end),
        amount: p.plan_price_yearly != null ? String(p.plan_price_yearly) : (p.plan_price_monthly != null ? String(p.plan_price_monthly) : ''),
        discount: '0',
        tax: '0',
        payment_method: 'UPI',
        payment_date: new Date().toISOString().slice(0, 10),
        payment_reference: '',
        payment_status: 'pending',
        notes: '',
      })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [cafeId, cafeName])

  const amountNum = Number(form.amount) || 0
  const discountNum = Number(form.discount) || 0
  const taxNum = Number(form.tax) || 0
  const grandTotal = Math.max(0, amountNum - discountNum + taxNum)

  function set<K extends keyof FormState>(key: K) {
    return (v: string) => setForm((f) => ({ ...f, [key]: v }))
  }

  async function submit() {
    if (!form.customer_name.trim()) return setError('Customer / business name is required.')
    if (!form.amount || amountNum <= 0) return setError('Enter a valid amount.')
    setSubmitting(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase.rpc('op_generate_invoice', {
      p_cafe_id: cafeId,
      p_customer_name: form.customer_name.trim(),
      p_customer_phone: form.customer_phone.trim() || null,
      p_customer_email: form.customer_email.trim() || null,
      p_billing_address: form.billing_address.trim() || null,
      p_billing_city: form.billing_city.trim() || null,
      p_billing_state: form.billing_state.trim() || null,
      p_billing_pincode: form.billing_pincode.trim() || null,
      p_billing_country: form.billing_country.trim() || 'India',
      p_gstin: form.gstin.trim() || null,
      p_plan_key: planKey,
      p_plan_name: form.plan_name.trim(),
      p_subscription_start: form.subscription_start || null,
      p_subscription_end: form.subscription_end || null,
      p_amount: amountNum,
      p_discount: discountNum,
      p_tax: taxNum,
      p_grand_total: grandTotal,
      p_payment_method: form.payment_method.trim() || null,
      p_payment_date: form.payment_date || null,
      p_payment_reference: form.payment_reference.trim() || null,
      p_payment_status: form.payment_status,
      p_notes: form.notes.trim() || null,
    })
    setSubmitting(false)
    if (err || !data) {
      setError(err?.message ?? 'Could not generate the invoice.')
      return
    }
    setGenerated(data as PlatformInvoice)
    toast(`Invoice ${(data as PlatformInvoice).invoice_number} generated.`)
    onGenerated?.()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] sm:max-h-[85vh] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              {generated ? 'Invoice generated' : `Generate invoice — ${cafeName}`}
            </h2>
            {!generated && <p className="mt-0.5 text-[12px] text-muted-foreground">Pre-filled from the café&apos;s own record — edit anything before generating.</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-surface-subtle hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-[13px] text-muted-foreground">Loading café details…</div>
        ) : generated ? (
          <div className="px-6 py-6">
            <p className="text-[13.5px] text-foreground">
              <span className="font-semibold">{generated.invoice_number}</span> for {generated.customer_name} — {money(generated.grand_total)}.
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Stored under Ops Admin → Billing → Invoices. You can download the PDF now or any time later.
            </p>
            <div className="mt-4 flex gap-2">
              <InvoicePdfButton invoice={generated} label="Download invoice PDF" />
              <button onClick={onClose} className="flex h-8 items-center rounded-[var(--radius-sm)] border border-border-strong px-3 text-[12px] font-medium text-foreground hover:bg-surface-subtle">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Bill to</p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {field('Customer / business name', form.customer_name, set('customer_name'), { className: 'col-span-2' })}
                {field('Phone', form.customer_phone, set('customer_phone'), { type: 'tel' })}
                {field('Email', form.customer_email, set('customer_email'), { type: 'email' })}
                {field('Billing address', form.billing_address, set('billing_address'), { className: 'col-span-2' })}
                {field('City', form.billing_city, set('billing_city'))}
                {field('State', form.billing_state, set('billing_state'))}
                {field('PIN code', form.billing_pincode, set('billing_pincode'))}
                {field('Country', form.billing_country, set('billing_country'))}
                {field('GSTIN (if applicable)', form.gstin, set('gstin'), { className: 'col-span-2' })}
              </div>

              <p className="mt-5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Plan &amp; subscription</p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {field('KhaoPiyo plan', form.plan_name, set('plan_name'), { className: 'col-span-2' })}
                {field('Subscription start', form.subscription_start, set('subscription_start'), { type: 'date' })}
                {field('Subscription end', form.subscription_end, set('subscription_end'), { type: 'date' })}
              </div>

              <p className="mt-5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</p>
              <div className="mt-2 grid grid-cols-3 gap-3">
                {field('Amount (₹)', form.amount, set('amount'), { type: 'number' })}
                {field('Discount (₹)', form.discount, set('discount'), { type: 'number' })}
                {field('GST / Tax (₹)', form.tax, set('tax'), { type: 'number' })}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5">
                <span className="text-[12.5px] font-medium text-foreground">Grand total</span>
                <span className="text-[15px] font-semibold tabular-nums text-foreground">{money(grandTotal)}</span>
              </div>

              <p className="mt-5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Payment</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Payments are received by personal UPI, outside any gateway — confirm you actually saw this payment land before marking it Paid.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {field('Payment method', form.payment_method, set('payment_method'), { placeholder: 'UPI' })}
                {field('Payment date', form.payment_date, set('payment_date'), { type: 'date' })}
                {field('UPI transaction / reference ID', form.payment_reference, set('payment_reference'), { className: 'col-span-2' })}
                <label className="col-span-2 block">
                  <span className="text-[11.5px] font-medium text-muted-foreground">Payment status</span>
                  <select
                    value={form.payment_status}
                    onChange={(e) => setForm((f) => ({ ...f, payment_status: e.target.value as FormState['payment_status'] }))}
                    className="mt-1 h-9 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-[13px] text-foreground"
                  >
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="partial">Partially paid</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                {field('Notes (optional)', form.notes, set('notes'), { className: 'col-span-2' })}
              </div>

              {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
            </div>

            <div className="flex shrink-0 gap-2 border-t border-border px-6 py-4">
              <button onClick={onClose} className="flex h-10 flex-1 items-center justify-center rounded-[var(--radius)] border border-border-strong text-[13.5px] font-medium text-foreground hover:bg-surface-subtle">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex h-10 flex-1 items-center justify-center rounded-[var(--radius)] bg-primary text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? 'Generating…' : 'Generate invoice'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function money(n: number): string {
  return `₹${(n ?? 0).toLocaleString('en-IN')}`
}
