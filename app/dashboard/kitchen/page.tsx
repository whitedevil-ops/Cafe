import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'
import KitchenClient from './kitchen-client'

export const dynamic = 'force-dynamic'

export default async function KitchenPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: tables }, { data: cafeRow }, { data: printer }] = await Promise.all([
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
  ])

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
    />
  )
}
