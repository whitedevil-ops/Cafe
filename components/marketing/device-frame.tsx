// Pure-CSS device bezels — no mockup library, no image assets. Each wraps
// arbitrary content (the real-pattern UI recreations in product-showcase.tsx)
// in a shape that reads unmistakably as "laptop" / "tablet" / "phone".

export function LaptopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-t-xl border border-b-0 border-border-strong bg-[#241D15] p-2 shadow-2xl">
        <div className="flex items-center gap-1.5 px-1.5 pb-2">
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        </div>
        <div className="overflow-hidden rounded-md bg-surface">{children}</div>
      </div>
      <div className="mx-auto h-3 w-[85%] rounded-b-xl bg-[#3D3427]" />
      <div className="mx-auto h-1.5 w-[35%] rounded-b-md bg-[#241D15]" />
    </div>
  )
}

export function TabletFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-[2rem] border-[10px] border-[#241D15] bg-[#241D15] shadow-2xl">
      <div className="overflow-hidden rounded-[1.1rem] bg-surface">{children}</div>
    </div>
  )
}

export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[2.25rem] border-[10px] border-[#241D15] bg-[#241D15] shadow-2xl">
      <div className="relative overflow-hidden rounded-[1.5rem] bg-surface">
        <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-[#241D15]" />
        {children}
      </div>
    </div>
  )
}
