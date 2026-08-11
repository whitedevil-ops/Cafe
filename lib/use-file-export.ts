'use client'

import { useCallback, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { savedFileHint } from '@/lib/is-desktop'

// Every export button in the dashboard used to be a `void somePromise()`, which
// meant two different silences with the same symptom:
//
//   - Success: the file saved, and in the desktop app nothing said so. A
//     browser draws its own download bar; the webview draws nothing at all.
//   - Failure: the promise rejected into nowhere. ExcelJS throwing on a large
//     report looked exactly like a button that does not work.
//
// A café cannot tell those apart, and both read as "the export is broken". One
// helper so neither can happen again, and so the wording stays identical
// everywhere rather than being retyped per report.

export function useFileExport() {
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)
  // A ref, not the state, guards re-entry: two clicks in the same tick would
  // both read the old state and both start an export.
  const inFlight = useRef(false)

  /**
   * @param produce Performs the download and resolves with the filename it
   *                saved, so the confirmation can name the actual file.
   */
  const runExport = useCallback(
    async (produce: () => string | Promise<string>): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      setExporting(true)
      try {
        toast(savedFileHint(await produce()))
      } catch (err) {
        // Say what failed rather than a bare "something went wrong" — on a
        // report export the cause is usually the date range being too wide,
        // and the underlying message is the only clue anyone gets.
        const detail = err instanceof Error && err.message ? `: ${err.message}` : ''
        toast(`Export failed${detail}`, 'error')
      } finally {
        inFlight.current = false
        setExporting(false)
      }
    },
    [toast],
  )

  return { runExport, exporting }
}
