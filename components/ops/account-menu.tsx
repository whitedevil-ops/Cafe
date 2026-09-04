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
  const [loggingOut, setLoggingOut] = useState(false)

  const [changingPassword, setChangingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function openChangePassword() {
    setOpen(false)
    setNewPassword('')
    setConfirmPassword('')
    setPwError(null)
    setChangingPassword(true)
  }

  // Already logged in with a valid session, so Supabase updates the password
  // directly — no current-password re-entry or email round-trip, same
  // direct-set pattern used for staff/admin password resets elsewhere.
  async function submitChangePassword() {
    if (newPassword.length < 8) return setPwError('Password must be at least 8 characters.')
    if (newPassword !== confirmPassword) return setPwError('Passwords do not match.')
    setSaving(true)
    setPwError(null)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(false)
    if (error) return setPwError(error.message)
    setChangingPassword(false)
    toast('Password changed.')
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
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-[var(--radius-lg)] border border-border bg-surface p-1.5 shadow-[var(--shadow-lg)]">
            <button
              onClick={openChangePassword}
              className="flex w-full items-center rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] text-foreground hover:bg-surface-subtle"
            >
              Change my password
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

      {changingPassword && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => setChangingPassword(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-[15px] font-semibold text-foreground">Change my password</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Takes effect immediately for this account.</p>
            <div className="mt-4 space-y-3">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 characters)"
                autoFocus
                className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground placeholder:text-muted-foreground"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground placeholder:text-muted-foreground"
              />
            </div>
            {pwError && (
              <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{pwError}</p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setChangingPassword(false)}
                className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={submitChangePassword}
                disabled={saving}
                className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
