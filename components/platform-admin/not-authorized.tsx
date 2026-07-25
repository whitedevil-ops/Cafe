export function NotAuthorized({ section }: { section: string }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="rounded-xl border border-border bg-surface p-10 text-center">
        <p className="text-sm font-medium text-destructive">Not authorized</p>
        <p className="mt-2 text-sm text-muted-foreground">Your admin role doesn&apos;t include access to {section}.</p>
      </div>
    </div>
  )
}
