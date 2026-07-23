'use client'

// Without this, any crash inside /dashboard/* renders the browser's blank
// "This page couldn't load" card with no message — which told us nothing
// while the dashboard was down. An error boundary that shows the real
// message is the difference between a 30-second fix and an hour of guessing.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Something broke on this screen</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The rest of the app is still running. Details below — send them over and it can be fixed properly.
      </p>

      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-[var(--radius)] border border-border bg-surface-subtle p-4 text-[12.5px] text-foreground">
{error.message || 'No error message was provided.'}
{error.digest ? `\n\nDigest: ${error.digest}` : ''}
      </pre>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={reset}
          className="min-h-11 rounded-[var(--radius)] bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="min-h-11 rounded-[var(--radius)] border border-border-strong px-5 py-2.5 text-sm font-medium text-foreground hover:bg-surface-subtle"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  )
}
