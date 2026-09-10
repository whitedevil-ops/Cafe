'use client'

import { useMemo, useState } from 'react'
import { Search, X, Eye } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Page, PageHeader, Badge, TableWrap, Thead, Th, Td, Tr, EmptyPanel, type StripTone } from '@/components/ops/ui'
import { InvoicePdfButton } from '@/components/ops/invoice-pdf-button'
import type { PlatformInvoice } from '@/lib/invoice-pdf-export'
import { formatDate } from '@/lib/datetime'

export type InvoiceRow = {
  id: string
  invoice_number: string
  cafe_id: string
  cafe_name: string
  customer_name: string
  plan_name: string
  grand_total: number
  payment_status: string
  created_at: string
}

const STATUS_TONE: Record<string, StripTone> = {
  paid: 'success', partial: 'warning', pending: 'warning', failed: 'destructive',
}
const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partially paid', pending: 'Pending', failed: 'Failed',
}

export default function InvoicesClient({
  initialInvoices,
  canManage,
}: {
  initialInvoices: InvoiceRow[]
  canManage: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [invoices, setInvoices] = useState(initialInvoices)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [viewing, setViewing] = useState<PlatformInvoice | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)

  async function runSearch(q: string) {
    setSearch(q)
    setSearching(true)
    const { data } = await supabase.rpc('op_list_invoices', { p_search: q || null, p_limit: 100 })
    setInvoices((data ?? []) as InvoiceRow[])
    setSearching(false)
  }

  async function openInvoice(id: string) {
    setViewError(null)
    const { data, error } = await supabase.rpc('op_get_invoice', { p_invoice_id: id })
    if (error || !data) {
      setViewError(error?.message ?? 'Could not load this invoice.')
      return
    }
    setViewing(data as PlatformInvoice)
  }

  return (
    <Page>
      <PageHeader
        title="Invoices"
        subtitle="Manually generated KhaoPiyo subscription invoices — payments are taken by personal UPI, outside any gateway, so these exist to give that money a paper trail. Generate one from a café's own Payments tab."
      />

      <div className="mt-5 flex justify-end">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => void runSearch(e.target.value)}
            placeholder="Search invoice #, customer or café…"
            className="h-9 w-64 rounded-[var(--radius)] border border-border-strong bg-surface pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="mt-4">
        {invoices.length === 0 ? (
          <EmptyPanel message={searching ? 'Searching…' : search ? 'No invoices match that search.' : 'No invoices generated yet.'} />
        ) : (
          <TableWrap minWidth={880}>
            <Thead>
              <Th>Invoice #</Th>
              <Th>Customer</Th>
              <Th>Plan</Th>
              <Th align="right">Amount</Th>
              <Th>Date</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </Thead>
            <tbody>
              {invoices.map((inv) => (
                <Tr key={inv.id}>
                  <Td><span className="font-mono text-[12.5px]">{inv.invoice_number}</span></Td>
                  <Td>
                    <span className="text-foreground">{inv.customer_name}</span>
                    {inv.customer_name !== inv.cafe_name && (
                      <span className="block text-[11.5px] text-muted-foreground">{inv.cafe_name}</span>
                    )}
                  </Td>
                  <Td muted>{inv.plan_name}</Td>
                  <Td align="right" numeric>₹{inv.grand_total.toLocaleString('en-IN')}</Td>
                  <Td muted>{formatDate(inv.created_at)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[inv.payment_status] ?? 'neutral'}>{STATUS_LABEL[inv.payment_status] ?? inv.payment_status}</Badge>
                  </Td>
                  <Td align="right">
                    <button
                      onClick={() => void openInvoice(inv.id)}
                      className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-border-strong px-2 text-[11.5px] font-medium text-foreground hover:bg-surface-subtle"
                    >
                      <Eye size={12} /> View
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {!canManage && (
        <p className="mt-4 text-[12px] text-muted-foreground">
          Your role can view invoices but not generate new ones — that needs the subscriptions.manage permission.
        </p>
      )}

      {viewError && (
        <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{viewError}</p>
      )}

      {viewing && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={() => setViewing(null)}>
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] sm:max-h-[80vh] sm:rounded-[var(--radius-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
              <h2 className="font-mono text-[14px] font-semibold text-foreground">{viewing.invoice_number}</h2>
              <button onClick={() => setViewing(null)} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-surface-subtle hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-[13px]">
              <Row label="Customer" value={viewing.customer_name} />
              {viewing.customer_phone && <Row label="Phone" value={viewing.customer_phone} />}
              {viewing.customer_email && <Row label="Email" value={viewing.customer_email} />}
              {(viewing.billing_address || viewing.billing_city) && (
                <Row label="Address" value={[viewing.billing_address, viewing.billing_city, viewing.billing_state, viewing.billing_pincode].filter(Boolean).join(', ')} />
              )}
              {viewing.gstin && <Row label="GSTIN" value={viewing.gstin} />}
              <Row label="Plan" value={viewing.plan_name} />
              <Row label="Subscription period" value={`${formatDate(viewing.subscription_start) || '—'} – ${formatDate(viewing.subscription_end) || '—'}`} />
              <Row label="Amount" value={`₹${viewing.amount.toLocaleString('en-IN')}`} />
              {viewing.discount > 0 && <Row label="Discount" value={`-₹${viewing.discount.toLocaleString('en-IN')}`} />}
              {viewing.tax > 0 && <Row label="GST / Tax" value={`₹${viewing.tax.toLocaleString('en-IN')}`} />}
              <Row label="Grand total" value={`₹${viewing.grand_total.toLocaleString('en-IN')}`} strong />
              <Row label="Payment method" value={viewing.payment_method ?? '—'} />
              <Row label="Payment date" value={formatDate(viewing.payment_date) || '—'} />
              {viewing.payment_reference && <Row label="Reference" value={viewing.payment_reference} />}
              <div className="mt-2 flex items-center justify-between py-1.5">
                <span className="text-muted-foreground">Status</span>
                <Badge tone={STATUS_TONE[viewing.payment_status] ?? 'neutral'}>{STATUS_LABEL[viewing.payment_status] ?? viewing.payment_status}</Badge>
              </div>
            </div>
            <div className="shrink-0 border-t border-border px-6 py-4">
              <InvoicePdfButton invoice={viewing} label="Download PDF" />
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right ${strong ? 'text-[14px] font-semibold text-foreground' : 'text-foreground'}`}>{value}</span>
    </div>
  )
}
