'use client'

import Link from 'next/link'

// Root-level fallback for every route NOT already covered by a more specific
// error.tsx (dashboard has its own, which shows the real error message since
// that's a staff-only surface). This one covers /t/[token] (QR ordering),
// /r/[token] (public receipts), /login, /ops, /onboarding — some
// of which face the open internet — so it deliberately shows no raw error
// text or stack, only a generic message.
export default function RootError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-destructive-subtle text-2xl text-destructive">!</div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This page hit a problem. Trying again usually fixes it — if it keeps happening, please try later.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={reset}
          className="min-h-11 rounded-[var(--radius)] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="min-h-11 rounded-[var(--radius)] border border-border-strong px-5 py-2.5 text-sm font-medium text-foreground hover:bg-surface-subtle"
        >
          Go home
        </Link>
      </div>
    </main>
  )
}
