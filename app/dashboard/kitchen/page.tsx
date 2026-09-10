import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'
import KitchenClient, { type Order, type Item } from './kitchen-client'

export const dynamic = 'force-dynamic'

export default async function KitchenPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  // Reuses the 'kds' key — seeded true on every plan since 0019, and
  // previously a confirmed-dead key nothing actually read (see the
  // full-product audit, 2026-09-10). This is the first real consumer.
  if (!(await hasFeature(cafe.cafeId, 'kds'))) {
    redirect('/dashboard')
  }

  const supabase = await createClient()
  const [{ data: tables }, { data: cafeRow }, { data: printer }, desktopPrintingAllowed, bluetoothPrinterAllowed, { data: initialOrders }] = await Promise.all([
    supabase.from('cafe_tables').select('id, label').eq('cafe_id', cafe.cafeId),
    supabase.from('cafes').select('kot_printing_enabled, timezone').eq('id', cafe.cafeId).maybeSingle(),
    // Browser printing has no printer to talk to, but the café's configured
    // roll width still decides the ticket layout. First enabled printer wins;
    // a café with none still prints at the 58mm default.
    supabase
      .from('kot_printers')
      .select('paper_width')
      .eq('cafe_id', cafe.cafeId)
      .eq('enabled', true)
      .order('created_at')
      .limit(1)
      .maybeSingle(),
    hasFeature(cafe.cafeId, 'desktop_printing'),
    hasFeature(cafe.cafeId, 'bluetooth_printer'),
    // Seeds the board for first paint — same shape as kitchen-client.tsx's own
    // poll(), which takes over 3s later. Without this the board renders empty
    // and only fills in after poll()'s first round-trip.
    supabase
      .from('orders')
      .select('id, short_code, table_id, type, status, total, payment_method, payment_status, created_at')
      .eq('cafe_id', cafe.cafeId)
      .in('status', ['placed', 'preparing', 'ready'])
      .order('created_at', { ascending: true }),
  ])

  // Needs the order ids above, so it can't join the batch itself — mirrors
  // poll()'s own two-step shape.
  const { data: initialItems } = initialOrders?.length
    ? await supabase
        .from('order_items')
        .select('id, order_id, name, qty, modifiers')
        .in('order_id', initialOrders.map((o) => o.id))
    : { data: [] as Item[] }

  const tableLabels: Record<string, string> = {}
  for (const t of tables ?? []) tableLabels[t.id] = t.label
  const printingEnabled = cafeRow?.kot_printing_enabled ?? false

  return (
    <KitchenClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      tableLabels={tableLabels}
      printingEnabled={printingEnabled}
      paperWidth={printer?.paper_width === '80mm' ? '80mm' : '58mm'}
      timezone={cafeRow?.timezone ?? DEFAULT_TIMEZONE}
      desktopPrintingEnabled={desktopPrintingAllowed}
      bluetoothPrinterEnabled={bluetoothPrinterAllowed}
      initialOrders={(initialOrders ?? []) as Order[]}
      initialItems={(initialItems ?? []) as Item[]}
    />
  )
}
