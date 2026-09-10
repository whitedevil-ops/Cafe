import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import InvoicesClient, { type InvoiceRow } from './invoices-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoices' }

export default async function InvoicesPage() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['subscriptions.view']) return <NotAuthorized section="invoices" />

  const { data: invoices } = await supabase.rpc('op_list_invoices', { p_search: null, p_limit: 100 })

  return (
    <InvoicesClient
      initialInvoices={(invoices ?? []) as InvoiceRow[]}
      canManage={!!permissions['subscriptions.manage']}
    />
  )
}
