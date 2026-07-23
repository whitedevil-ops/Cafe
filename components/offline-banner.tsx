'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

// DELIBERATELY NOT AN OFFLINE WRITE QUEUE. Queuing orders/payments locally and
// replaying them on reconnect would mean money-affecting writes built from
// prices the device cached minutes or hours ago, plus duplicate-submission
// risk on a flaky connection — exactly the "money must be server-validated,
// never client-authoritative" rule this project holds everywhere else.
// What a café actually needs from a dropped connection is to KNOW, instantly
// and unmissably, so staff can fall back to pen and paper for sixty seconds
// rather than tapping a dead button and assuming the order went through.
export function useOnlineStatus() {
  // Starts optimistic: navigator is unavailable during SSR, and a false
  // "offline" flash on every page load would train staff to ignore it.
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

export function OfflineBanner({ variant = 'staff' }: { variant?: 'staff' | 'customer' | 'kds' }) {
  const online = useOnlineStatus()
  if (online) return null

  const message =
    variant === 'customer'
      ? 'You’re offline. Your order can’t be sent right now — please ask a staff member.'
      : variant === 'kds'
        ? 'Offline — this board is frozen and may be missing new orders. Check with the counter.'
        : 'Offline — nothing you do here will save until the connection returns.'

  return (
    <div
      role="status"
      aria-live="assertive"
      className={
        variant === 'kds'
          ? 'flex items-center justify-center gap-2 bg-red-600 px-4 py-3 text-base font-medium text-white'
          : 'flex items-center justify-center gap-2 bg-destructive px-4 py-2.5 text-[13.5px] font-medium text-white'
      }
    >
      <WifiOff size={variant === 'kds' ? 20 : 16} />
      {message}
    </div>
  )
}
