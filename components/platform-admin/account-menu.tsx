'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'

export function AccountMenu({ fullName, role, email }: { fullName: string; role: string; email: string }) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const { toast } = useToast()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  async function resetOwnPassword() {
    setOpen(false)
    setResetting(true)
    const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${base}/login` })
    setResetting(false)
    if (error) return toast(error.message, 'error')
    toast(`Reset link sent to ${email}.`)
  }

  async function logOutAllDevices() {
    setOpen(false)
    const ok = await confirm({
      title: 'Log out of all devices?',
      description: 'Every session for your account — including this one — will be signed out immediately.',
      confirmLabel: 'Log out everywhere',
      destructive: true,
    })
    if (!ok) return
    setLoggingOut(true)
    // scope: 'global' revokes every refresh token for this account, not just
    // the current browser — this one included, so a redirect to /login follows.
    await supabase.auth.signOut({ scope: 'global' })
    router.push('/login')
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full truncate rounded-[var(--radius)] px-1 py-1 text-left text-[12px] text-white/40 hover:text-white/70"
        title={email}
      >
        {fullName} · <span className="capitalize">{role.replace('_', ' ')}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-9 left-0 z-50 w-56 rounded-[var(--radius-lg)] border border-border bg-surface p-1.5 shadow-[var(--shadow-lg)]">
            <button
              onClick={resetOwnPassword}
              disabled={resetting}
              className="flex w-full items-center rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] text-foreground hover:bg-surface-subtle disabled:opacity-50"
            >
              {resetting ? 'Sending…' : 'Reset my password'}
            </button>
            <button
              onClick={logOutAllDevices}
              disabled={loggingOut}
              className="flex w-full items-center rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] text-destructive hover:bg-destructive-subtle disabled:opacity-50"
            >
              {loggingOut ? 'Logging out…' : 'Log out of all devices'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
