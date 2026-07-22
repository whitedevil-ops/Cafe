'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmContextValue = { confirm: (options: ConfirmOptions) => Promise<boolean> }
const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(v: boolean) => void>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  function settle(value: boolean) {
    setOptions(null)
    resolver.current?.(value)
    resolver.current = null
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => settle(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div className="flex items-start gap-3">
              {options.destructive && (
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-destructive-subtle text-destructive">
                  <AlertTriangle size={18} />
                </span>
              )}
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-[15px] font-semibold text-foreground">{options.title}</h2>
                {options.description && (
                  <p className="mt-1 text-[13px] text-muted-foreground">{options.description}</p>
                )}
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => settle(false)}
                className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground"
              >
                {options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                onClick={() => settle(true)}
                className={`min-h-11 flex-1 rounded-[var(--radius)] text-[14px] font-medium text-white ${
                  options.destructive ? 'bg-destructive' : 'bg-primary'
                }`}
              >
                {options.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}
