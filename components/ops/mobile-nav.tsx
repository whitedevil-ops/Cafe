'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'
import { SidebarNav, type NavKey } from './sidebar-nav'

// The mobile fallback used to be every nav link wrapped into a flex row of
// 13px text under the logo — technically navigable, unreadable in practice.
// A real drawer that closes on selection is the minimum here.

export function MobileNav({ allowed }: { allowed: NavKey[] }) {
  const [open, setOpen] = useState(false)

  return (
    <header className="border-b border-white/10 bg-[#0B0D10] md:hidden">
      <div className="flex items-center justify-between px-5 py-3">
        <span className="flex items-center gap-2 font-semibold tracking-tight text-white">
          <Image src="/logo-mark.png" alt="" width={22} height={22} className="h-[22px] w-[22px]" />
          KhaoPiyo
          <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-amber-300">
            Operator
          </span>
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-white/70 hover:bg-white/5 hover:text-white"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 px-3 pb-4 pt-3">
          <SidebarNav allowed={allowed} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </header>
  )
}
