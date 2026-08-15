import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import TablesClient, { type TableRow } from '../tables-client'

export const dynamic = 'force-dynamic'

export default async function ManageTablesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  // Member-gated RPC rather than a direct select: the token column is revoked
  // from `authenticated` in migration 0132 (the `public read using (true)`
  // policy from 0001 would otherwise let any signed-in owner read every OTHER
  // café's tokens). This café's own tokens still come back — QR generation
  // needs the real value.
  const { data } = await supabase.rpc('list_cafe_tables_with_tokens', { p_cafe_id: cafe.cafeId })

  return (
    <div>
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <Link href="/dashboard/tables" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to floor view
        </Link>
      </div>
      <TablesClient cafeId={cafe.cafeId} slug={cafe.slug} initialTables={(data ?? []) as TableRow[]} />
    </div>
  )
}
