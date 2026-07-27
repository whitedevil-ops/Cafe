// Every dashboard page is `dynamic = 'force-dynamic'` and fetches its own
// data server-side on each navigation — without this file, that round trip
// showed nothing at all: the old screen just sat there, frozen, until the
// new page was fully ready. This is the Suspense fallback Next.js swaps in
// the instant a click starts a navigation, so it always feels immediate.
//
// One generic shape (title + metric row + list) covers most dashboard pages
// well enough — it's a placeholder felt for a fraction of a second, not a
// pixel-perfect match for every page.
function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-sm)] bg-surface-subtle ${className}`} />
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <Bar className="h-7 w-48" />
      <Bar className="mt-3 h-4 w-72" />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-3.5">
            <Bar className="h-3 w-16" />
            <Bar className="mt-2 h-5 w-20" />
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-2">
        <Bar className="h-9 w-20 rounded-full" />
        <Bar className="h-9 w-24 rounded-full" />
        <Bar className="h-9 w-20 rounded-full" />
      </div>

      <div className="mt-5 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
