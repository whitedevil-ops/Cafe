'use client'

import { Download, Printer } from 'lucide-react'
import type { ReceiptData } from '@/lib/pdf-export'
import { useFileExport } from '@/lib/use-file-export'

export function ReceiptDownloadButton({ receipt }: { receipt: ReceiptData }) {
  // Previously this only toggled a local "Preparing…" label and swallowed any
  // failure in a bare try/finally. A guest on the desktop app or an in-app
  // browser got no download bar and no message, so a saved bill and a crashed
  // jsPDF looked identical.
  const { runExport, exporting } = useFileExport()

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">
      <button
        onClick={() =>
          void runExport(async () => {
            // Dynamic import: jsPDF (~136KB gzip) should only load once a
            // visitor actually wants a download, not on every receipt view.
            const { downloadReceiptPdf } = await import('@/lib/pdf-export')
            return downloadReceiptPdf(receipt)
          })
        }
        disabled={exporting}
        className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-border-strong bg-surface py-2.5 text-[13.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-60"
      >
        <Download size={15} />
        {exporting ? 'Preparing…' : 'Download'}
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
