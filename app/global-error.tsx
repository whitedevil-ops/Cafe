'use client'

// Catches a crash in the root layout itself — the one case app/error.tsx
// cannot reach. Deliberately self-contained (no font loader, no
// Toast/ConfirmProvider) so the one file whose job is to survive a broken
// root layout doesn't carry its own extra ways to fail. Still imports
// globals.css so the design tokens render correctly, not raw unstyled HTML.
import './globals.css'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" className="h-full">
      <body className="grid min-h-full place-items-center bg-background p-6 antialiased">
        <main className="flex w-full max-w-md flex-col items-center gap-5 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-destructive-subtle text-2xl text-destructive">!</div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Something went wrong</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              The app hit a problem loading this page. Trying again usually fixes it.
            </p>
          </div>
          <button
            onClick={reset}
            className="min-h-11 rounded-[var(--radius)] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
