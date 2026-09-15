'use client'

import { useState } from 'react'
import { Share, Download, X } from 'lucide-react'
import { usePwaInstall } from '@/lib/use-pwa-install'

// Inline, dismissible — never position:fixed/overlay, so it can never cover
// an order button, a table, or a bill total. The caller decides WHERE this
// renders (top of the dashboard shell, below a guest's paid receipt, etc.);
// this component only decides WHETHER to render anything at all, which is
// almost always nothing (desktop, already installed, already dismissed, or
// a platform with no install path).
export function PwaInstallPrompt({ className = '' }: { className?: string }) {
  const { show, platform, install, dismiss } = usePwaInstall()
  const [installing, setInstalling] = useState(false)

  if (!show) return null

  async function handleInstall() {
    setInstalling(true)
    await install()
    setInstalling(false)
  }

  return (
    <div
      role="region"
      aria-label="Install KhaoPiyo"
      className={`flex items-start gap-3 rounded-[var(--radius)] border border-border-strong bg-surface px-4 py-3 shadow-[var(--shadow-sm)] ${className}`}
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] bg-accent/10 text-accent">
        {platform === 'ios' ? <Share size={16} /> : <Download size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        {platform === 'ios' ? (
          <>
            <p className="text-[13.5px] font-medium text-foreground">Add KhaoPiyo to your Home Screen</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Tap <span className="font-medium text-foreground">Share</span>, then{' '}
              <span className="font-medium text-foreground">Add to Home Screen</span>, then{' '}
              <span className="font-medium text-foreground">Add</span>.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13.5px] font-medium text-foreground">Install KhaoPiyo</p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">Get faster access from your Home Screen.</p>
            <button
              onClick={handleInstall}
              disabled={installing}
              className="mt-2.5 min-h-9 rounded-[var(--radius)] bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
          </>
        )}
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius)] text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
      >
        <X size={15} />
      </button>
    </div>
  )
}
