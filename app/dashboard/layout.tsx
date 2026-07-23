import { redirect } from 'next/navigation'
import { getCurrentCafe, getMyCafes } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { AppShell } from '@/components/shell/app-shell'

export const dynamic = 'force-dynamic'

const STATUS_MESSAGE: Record<string, string> = {
  suspended: 'This café account has been suspended.',
  disabled: 'This café account has been disabled.',
  archived: 'This café account has been archived.',
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [cafe, myCafes] = await Promise.all([getCurrentCafe(), getMyCafes()])
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: cafeRow }, { data: profile }] = await Promise.all([
    supabase.from('cafes').select('cash_management_enabled').eq('id', cafe.cafeId).maybeSingle(),
    supabase.from('profiles').select('full_name').eq('id', cafe.userId).maybeSingle(),
  ])

  if (cafe.status !== 'active') {
    return (
      <div className="grid w-full min-h-dvh place-items-center bg-background px-6 text-center">
        <div>
          <p className="text-sm font-medium text-destructive">Account access paused</p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            {STATUS_MESSAGE[cafe.status] ?? 'This café account is not currently active.'}
          </h1>
          {cafe.statusReason && (
            <p className="mt-2 text-sm text-muted-foreground">Reason: {cafe.statusReason}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            Orders, POS, and staff access are paused until this is resolved. Contact support to continue.
          </p>
          <form action="/auth/signout" method="post" className="mt-6">
            <button className="text-sm font-medium text-primary hover:underline">Sign out</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <AppShell
      cafeName={cafe.name}
      cafeId={cafe.cafeId}
      role={cafe.role}
      timezone={cafe.timezone}
      cashEnabled={cafeRow?.cash_management_enabled ?? false}
      cafes={myCafes}
      userName={profile?.full_name ?? ''}
    >
      {children}
    </AppShell>
  )
}
