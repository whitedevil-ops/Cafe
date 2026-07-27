// Same gap as app/dashboard/loading.tsx — platform-admin pages are also all
// force-dynamic with server-side data fetching and had no loading fallback,
// so a click just froze the screen until the new page was fully ready.
function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-sm)] bg-surface-subtle ${className}`} />
}

export default function PlatformAdminLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Bar className="h-7 w-52" />
      <Bar className="mt-3 h-4 w-80" />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-3.5">
            <Bar className="h-3 w-16" />
            <Bar className="mt-2 h-5 w-20" />
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
