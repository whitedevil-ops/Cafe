'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { LEGAL_DOCS, legalDocVersion, type Doc } from '@/lib/legal-content'
import { LegalDocBody } from '@/components/legal/legal-doc-body'

// The one reusable Terms & Conditions consent modal — used by signup and by
// the paid-subscription flow, and meant to be the only place in the product
// that implements "make someone actually scroll through this before they can
// agree." Deliberately dumb about WHAT agreeing means: it tracks scroll
// position and calls onAgree() once, and leaves recording the acceptance
// (an admin-client insert during signup, an authenticated RPC call during
// checkout — two different auth contexts) entirely to the caller.
//
// A few px of slack on the "reached bottom" check rather than an exact
// equality — browsers round scroll dimensions to sub-pixel values
// differently, and an exact match against scrollHeight can permanently miss
// by a fraction of a pixel on some zoom levels.
const BOTTOM_SLACK_PX = 8

export type TermsModalProps = {
  open: boolean
  /** Defaults to 'terms' — the Terms of Service. Privacy Policy is treated as
   *  a plain disclosure elsewhere, not a scroll-gated agreement (see the
   *  audit note in signup's page for why the two are kept distinct). */
  docType?: keyof typeof LEGAL_DOCS
  onClose: () => void
  onAgree: () => void | Promise<void>
}

export function TermsModal({ open, docType = 'terms', onClose, onAgree }: TermsModalProps) {
  const doc: Doc = LEGAL_DOCS[docType]
  const [reachedBottom, setReachedBottom] = useState(false)
  const [agreeing, setAgreeing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Reset per-open, not per-mount — the same modal instance can be closed
  // and reopened (e.g. dismissed, then reopened from "Read & agree" again)
  // without a full remount, and a stale reachedBottom=true from a previous
  // open must not silently carry over. Adjusted during render (React's own
  // recommended pattern for "reset state when a prop changes") rather than
  // in an effect, which would set state one render late.
  const [prevOpenKey, setPrevOpenKey] = useState(`${open}:${docType}`)
  const openKey = `${open}:${docType}`
  if (openKey !== prevOpenKey) {
    setPrevOpenKey(openKey)
    if (open) setReachedBottom(false)
  }

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Focus management: move focus into the dialog on open, restore it to
  // whatever triggered the modal on close — a screen-reader or keyboard user
  // should never lose their place in the underlying page.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null
      closeButtonRef.current?.focus()
    } else {
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  // Escape closes; Tab is trapped inside the dialog so focus can't silently
  // escape to the (scroll-locked but still-present) page behind it.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  function checkBottom() {
    const el = scrollRef.current
    if (!el) return
    // Covers the "content is shorter than the container" case too — when
    // there's nothing to scroll, scrollHeight <= clientHeight is already
    // true on the very first check, so the button never stays permanently
    // disabled for a short document.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
    if (atBottom) setReachedBottom(true)
  }

  // Runs after the dialog (and its real content) has actually painted, so a
  // short document is measured against its real rendered height rather than
  // a pre-layout guess. Re-checked on resize too — rotating a phone from
  // portrait to landscape can turn a scrollable document into a fully
  // visible one without the user touching the scroll area at all.
  useLayoutEffect(() => {
    if (!open) return
    checkBottom()
    window.addEventListener('resize', checkBottom)
    return () => window.removeEventListener('resize', checkBottom)
  }, [open, docType])

  async function handleAgree() {
    if (!reachedBottom || agreeing) return
    setAgreeing(true)
    try {
      await onAgree()
    } finally {
      setAgreeing(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-modal-title"
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] sm:max-h-[80vh] sm:rounded-[var(--radius-lg)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 id="terms-modal-title" className="text-[17px] font-semibold tracking-tight text-foreground">
              {doc.title}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Last updated: {doc.updated}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-surface-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          >
            <X size={18} />
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={checkBottom}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5"
        >
          <LegalDocBody doc={doc} variant="modal" showReview={false} />
          <p className="mt-6 text-[12px] font-medium text-muted-foreground" aria-hidden="true">
            — end of document —
          </p>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4">
          {!reachedBottom && (
            <p className="mb-3 text-[12px] text-muted-foreground">Scroll to the bottom to continue.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground hover:bg-surface-subtle"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleAgree}
              disabled={!reachedBottom || agreeing}
              aria-disabled={!reachedBottom || agreeing}
              className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-primary-foreground transition-opacity hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {agreeing ? 'Saving…' : 'Agree & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { legalDocVersion }
