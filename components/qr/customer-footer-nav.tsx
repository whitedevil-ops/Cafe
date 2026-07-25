'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UtensilsCrossed, ClipboardList, Receipt, Check } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// Persistent mobile bottom nav for the customer-facing QR flow: Menu, Orders,
// Pay bill. Self-contained — owns its own supabase client and the
// request_bill call — so it can be dropped into any screen with just a
// table token, no state wiring from the parent page.
export function CustomerFooterNav({ token }: { token: string }) {
  const pathname = usePathname()
  const onMenu = pathname === `/t/${token}`
  const onOrders = pathname.startsWith(`/t/${token}/orders`)

  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState(false)

  async function payBill() {
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('request_bill', { p_token: token })
    setBusy(false)
    if (error) return
    setRequested(true)
    setTimeout(() => setRequested(false), 4000)
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-md items-stretch pb-[env(safe-area-inset-bottom)]">
        <Link
          href={`/t/${token}`}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
            onMenu ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <UtensilsCrossed size={20} />
          Menu
        </Link>
        <Link
          href={`/t/${token}/orders`}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
            onOrders ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <ClipboardList size={20} />
          Orders
        </Link>
        <button
          onClick={payBill}
          disabled={busy}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium disabled:opacity-50 ${
            requested ? 'text-success' : 'text-muted-foreground'
          }`}
        >
          {requested ? <Check size={20} /> : <Receipt size={20} />}
          {requested ? 'Requested' : 'Pay bill'}
        </button>
      </div>
    </nav>
  )
}
