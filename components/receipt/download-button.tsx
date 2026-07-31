'use client'

import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { downloadReceiptPdf, type ReceiptData } from '@/lib/pdf-export'

export function ReceiptDownloadButton({ receipt }: { receipt: ReceiptData }) {
  const [busy, setBusy] = useState(false)

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">
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
        className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-border-strong bg-surface py-2.5 text-[13.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-60"
      >
        <Download size={15} />
        {busy ? 'Preparing…' : 'Download'}
      </button>
      <button
        onClick={() => window.print()}
        className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-border-strong bg-surface py-2.5 text-[13.5px] font-medium text-foreground hover:bg-surface-subtle"
      >
        <Printer size={15} />
        Print
      </button>
    </div>
  )
}
