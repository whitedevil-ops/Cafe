'use client'

import { Download } from 'lucide-react'
import type { PlatformInvoice } from '@/lib/invoice-pdf-export'
import { useFileExport } from '@/lib/use-file-export'

// Same pattern as components/receipt/download-button.tsx — dynamic import so
// jsPDF only loads once an admin actually wants a PDF, and useFileExport so a
// failure (or the desktop app's silent-download webview) is never mistaken
// for a button that does nothing.
export function InvoicePdfButton({ invoice, label = 'Download PDF' }: { invoice: PlatformInvoice; label?: string }) {
  const { runExport, exporting } = useFileExport()

  return (
    <button
      onClick={() =>
        void runExport(async () => {
          const { downloadPlatformInvoicePdf } = await import('@/lib/invoice-pdf-export')
          return downloadPlatformInvoicePdf(invoice)
        })
      }
      disabled={exporting}
      className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-strong px-2.5 text-[12px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50"
    >
      <Download size={13} />
      {exporting ? 'Preparing…' : label}
    </button>
  )
}
