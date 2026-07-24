import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import FloorLayoutEditor, { type Area, type LayoutTable } from './layout-editor'

export const dynamic = 'force-dynamic'

export default async function FloorLayoutPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')
  // Editing the layout is owner/manager only (RBAC). The save_floor_layout RPC
  // re-checks this server-side regardless of the UI.
  if (cafe.role !== 'owner' && cafe.role !== 'manager') redirect('/dashboard/tables')

  const supabase = await createClient()
  const [{ data: areas }, { data: tables }] = await Promise.all([
    supabase.from('floor_areas').select('id, name, sort, archived').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase
      .from('cafe_tables')
      .select('id, label, capacity, area_id, archived')
      .eq('cafe_id', cafe.cafeId)
      .eq('archived', false)
      .order('label'),
  ])

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
      <Link href="/dashboard/tables" className="text-sm text-muted-foreground hover:text-foreground">← Back to floor view</Link>
      <FloorLayoutEditor
        cafeId={cafe.cafeId}
        initialAreas={(areas ?? []) as Area[]}
        initialTables={(tables ?? []) as LayoutTable[]}
      />
    </div>
  )
}
