'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { downloadReceiptPdf, type ReceiptData } from '@/lib/pdf-export'

export function ReceiptDownloadButton({ receipt }: { receipt: ReceiptData }) {
  const [busy, setBusy] = useState(false)

  return (
    <button
      onClick={() => {
        setBusy(true)
        try {
          downloadReceiptPdf(receipt)
        } finally {
          setBusy(false)
        }
      }}
      disabled={busy}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-border-strong bg-surface py-2.5 text-[13.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-60"
    >
      <Download size={15} />
      {busy ? 'Preparing…' : 'Download bill'}
    </button>
  )
}
