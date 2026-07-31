'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

// The receipt page (app/r/[token]/page.tsx) is an async server component, so
// it can't itself read the query string or call window.print(). This mounts
// alongside it purely to fire the OS print dialog once when a Print Bill
// link (?print=1) opened the page — the bill content underneath is already
// styled for print via the `print:` variants on the page itself.
export function AutoPrint() {
  const params = useSearchParams()
  const shouldPrint = params.get('print') === '1'

  useEffect(() => {
    if (shouldPrint) window.print()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
