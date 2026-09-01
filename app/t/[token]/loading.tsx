// The QR menu page runs 3 Supabase calls (table resolve, then menu +
// coupons + ordering concurrently) before it can render anything — without
// this file that round trip was a blank screen. Shape mirrors menu-client's
// header (logo + name/table) and sticky search/category bar, then a card
// grid, so the swap-in doesn't jump.
function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-sm)] bg-surface-subtle ${className}`} />
}

export default function TablePageLoading() {
  return (
    <main className="w-full min-h-dvh bg-background pb-28">
      <div className="mx-auto w-full max-w-6xl px-4 pb-3 pt-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Bar className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Bar className="h-5 w-40" />
            <Bar className="mt-2 h-3.5 w-24" />
          </div>
          <Bar className="h-10 w-10 shrink-0 rounded-full" />
        </div>
      </div>

      <div className="border-b border-border pb-2.5">
        <div className="mx-auto w-full max-w-6xl px-4 pt-2.5 sm:px-6">
          <Bar className="h-11 w-full rounded-full" />
          <div className="mt-2.5 flex gap-2">
            <Bar className="h-8 w-16 rounded-full" />
            <Bar className="h-8 w-20 rounded-full" />
            <Bar className="h-8 w-16 rounded-full" />
            <Bar className="h-8 w-24 rounded-full" />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
        <Bar className="h-3 w-20" />
        <div className="mt-3 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <Bar className="aspect-[4/3] w-full rounded-none" />
              <div className="p-3">
                <Bar className="h-3.5 w-3/4" />
                <Bar className="mt-2 h-3.5 w-10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
