'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import KotPrintingPanel, { type KotPrinter, type KitchenStation, type BridgeToken } from './kot-printing-panel'
import CashManagementPanel from './cash-management-panel'
import RoleAccessPanel, { type RoleScreenOverview } from './role-access-panel'

type Settings = {
  name: string
  upsell_threshold: number
  recommendations_enabled: boolean
}

export type StaffMember = {
  userId: string
  role: string
  status: string
  name: string | null
  email: string | null
}
export type StaffInvite = { id: string; email: string; role: string }
export type PrintingState = {
  enabled: boolean
  printers: KotPrinter[]
  stations: KitchenStation[]
  tokens: BridgeToken[]
}

const INVITE_ROLES = ['manager', 'cashier', 'kitchen', 'waiter', 'accountant'] as const

export default function SettingsClient({
  cafeId,
  myUserId,
  myRole,
  initial,
  initialStaff,
  initialInvites,
  timezone,
  cashEnabled,
  printing,
  roleOverview,
}: {
  cafeId: string
  myUserId: string
  myRole: string
  initial: Settings
  initialStaff: StaffMember[]
  initialInvites: StaffInvite[]
  timezone: string
  cashEnabled: boolean
  printing: PrintingState
  roleOverview: RoleScreenOverview
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [staff, setStaff] = useState(initialStaff)
  const [invites, setInvites] = useState(initialInvites)
  const [staffError, setStaffError] = useState<string | null>(null)
  const isAdmin = myRole === 'owner' || myRole === 'manager'

  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newConfirmPassword, setNewConfirmPassword] = useState('')
  const [newRole, setNewRole] = useState<string>('waiter')
  const [createBusy, setCreateBusy] = useState(false)

  const [resettingId, setResettingId] = useState<string | null>(null)
  const [resetPwValue, setResetPwValue] = useState('')
  const [resetPwConfirm, setResetPwConfirm] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  async function createStaff() {
    setStaffError(null)
    if (!newName.trim()) return setStaffError('Enter their name.')
    const email = newEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) return setStaffError('Enter a valid email.')
    if (newPassword.length < 8) return setStaffError('Password must be at least 8 characters.')
    if (newPassword !== newConfirmPassword) return setStaffError('Passwords do not match.')
    setCreateBusy(true)
    const res = await fetch('/api/staff/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cafe_id: cafeId, full_name: newName.trim(), email,
        password: newPassword, confirm_password: newConfirmPassword, role: newRole,
      }),
    })
    const resBody = await res.json().catch(() => ({}))
    setCreateBusy(false)
    if (!res.ok) return setStaffError(resBody.error ?? 'Could not create account.')
    setStaff((list) => [...list, { userId: resBody.member.userId, role: resBody.member.role, status: 'active', name: resBody.member.name, email: resBody.member.email }])
    setNewName(''); setNewEmail(''); setNewPassword(''); setNewConfirmPassword(''); setNewRole('waiter')
    toast(`${resBody.member.name} can now sign in.`)
  }

  async function submitPasswordReset(m: StaffMember) {
    setStaffError(null)
    if (resetPwValue.length < 8) return setStaffError('Password must be at least 8 characters.')
    if (resetPwValue !== resetPwConfirm) return setStaffError('Passwords do not match.')
    setResetBusy(true)
    const res = await fetch('/api/staff/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId, user_id: m.userId, password: resetPwValue, confirm_password: resetPwConfirm }),
    })
    const resBody = await res.json().catch(() => ({}))
    setResetBusy(false)
    if (!res.ok) return setStaffError(resBody.error ?? 'Could not reset password.')
    setResettingId(null); setResetPwValue(''); setResetPwConfirm('')
    toast(`Password reset for ${m.name ?? m.email}.`)
  }

  async function removeInvite(id: string) {
    const { error } = await supabase.from('cafe_invites').delete().eq('id', id)
    if (error) return setStaffError(error.message)
    setInvites((list) => list.filter((i) => i.id !== id))
  }

  async function copyInviteMessage(iv: StaffInvite) {
    const signupUrl = `${window.location.origin}/signup`
    const message = `You've been invited to join ${form.name || 'our café'} on KhaoPiyo as a ${iv.role}. Sign up here using this exact email address (${iv.email}): ${signupUrl}`
    await navigator.clipboard.writeText(message)
    toast('Invite message copied — paste it into WhatsApp, SMS, or email.')
  }

  async function removeMember(m: StaffMember) {
    const label = m.name ?? m.email ?? 'this member'
    const ok = await confirm({
      title: `Remove ${label}?`,
      description: 'They lose access to this café immediately.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase
      .from('cafe_members')
      .delete()
      .eq('cafe_id', cafeId)
      .eq('user_id', m.userId)
    if (error) return setStaffError(error.message)
    setStaff((list) => list.filter((x) => x.userId !== m.userId))
    toast(`${label} removed.`)
  }

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('cafes')
      .update({
        name: form.name.trim() || initial.name,
        upsell_threshold: Math.max(0, Math.round(Number(form.upsell_threshold) || 0)),
        recommendations_enabled: form.recommendations_enabled,
      })
      .eq('id', cafeId)
    setBusy(false)
    if (error) return setError(error.message)
    toast('Settings saved.')
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Café details and payments.</p>

      <div className="mt-8 space-y-4">
        <Input
          label="Café name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">Payments</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Customers place orders and pay at the counter — staff record <span className="font-medium text-foreground">cash</span> or{' '}
            <span className="font-medium text-foreground">card</span> on the Tables or Kitchen screen.
            Online UPI collection is <span className="font-medium text-foreground">not enabled yet</span>;
            it will appear here once a payment provider is configured.
          </p>
        </div>

        <Input
          label="Upsell threshold (₹)"
          type="number"
          min={0}
          value={String(form.upsell_threshold)}
          onChange={(e) => setForm({ ...form, upsell_threshold: Number(e.target.value) })}
          hint="Cart value at which the add-on nudge appears on the QR menu."
        />

        <label className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border-strong bg-surface px-4 py-3">
          <span>
            <span className="block text-[13.5px] font-medium text-foreground">Smart recommendations</span>
            <span className="block text-[12px] text-muted-foreground">Suggest complementary add-ons on the QR menu and POS — never a required setting.</span>
          </span>
          <input
            type="checkbox"
            checked={form.recommendations_enabled}
            onChange={(e) => setForm({ ...form, recommendations_enabled: e.target.checked })}
            className="h-5 w-5 shrink-0"
          />
        </label>

        {error && (
          <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>
        )}

        <Button onClick={save} loading={busy}>Save settings</Button>

        {/* Staff — per-café logins */}
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-foreground">Staff</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Create a login for staff yourself — set their password below and tell them
            directly. No email or message is sent. They can change their password after
            signing in; you can reset it here any time.
          </p>

          <ul className="mt-4 divide-y divide-border">
            {staff.map((m) => (
              <li key={m.userId} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{m.name ?? m.email ?? '—'}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{m.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[12px] font-medium capitalize text-foreground">
                      {m.role}
                    </span>
                    {isAdmin && m.userId !== myUserId && m.role !== 'owner' && (
                      <>
                        <button
                          onClick={() => {
                            setResettingId(resettingId === m.userId ? null : m.userId)
                            setResetPwValue(''); setResetPwConfirm(''); setStaffError(null)
                          }}
                          className="min-h-11 px-2 text-[13px] font-medium text-primary hover:underline"
                        >
                          {resettingId === m.userId ? 'Cancel' : 'Reset password'}
                        </button>
                        <button
                          onClick={() => removeMember(m)}
                          className="min-h-11 px-2 text-[13px] text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {resettingId === m.userId && (
                  <div className="mt-2 flex flex-wrap gap-2 rounded-[var(--radius)] bg-surface-subtle p-3">
                    <input
                      type="password"
                      value={resetPwValue}
                      onChange={(e) => setResetPwValue(e.target.value)}
                      placeholder="New password (min 8 characters)"
                      className="h-10 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                    <input
                      type="password"
                      value={resetPwConfirm}
                      onChange={(e) => setResetPwConfirm(e.target.value)}
                      placeholder="Confirm"
                      className="h-10 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                    />
                    <Button size="sm" onClick={() => submitPasswordReset(m)} loading={resetBusy}>Save</Button>
                  </div>
                )}
              </li>
            ))}
            {invites.length > 0 && (
              <li className="py-2 text-[11.5px] text-muted-foreground">
                Older pending invites — the email-invite flow is retired, but these still work if that person signs up with the matching email.
              </li>
            )}
            {invites.map((iv) => (
              <li key={iv.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{iv.email}</p>
                  <p className="text-[12px] text-warning">Invited — waiting for signup</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[12px] font-medium capitalize text-foreground">
                    {iv.role}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={() => copyInviteMessage(iv)}
                      className="min-h-11 px-2 text-[13px] font-medium text-primary hover:underline"
                    >
                      Copy message
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => removeInvite(iv.id)}
                      className="min-h-11 px-2 text-[13px] text-muted-foreground hover:text-destructive"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {isAdmin && (
            <div className="mt-3 space-y-2 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                  className="h-11 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="staff@email.com"
                  className="h-11 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  aria-label="Role"
                  className="h-11 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-sm capitalize text-foreground"
                >
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Password (min 8 characters)"
                  className="h-11 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <input
                  type="password"
                  value={newConfirmPassword}
                  onChange={(e) => setNewConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="h-11 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <Button size="sm" onClick={createStaff} loading={createBusy}>Create login</Button>
              </div>
            </div>
          )}
          {staffError && (
            <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
              {staffError}
            </p>
          )}
        </div>
      </div>

      {isAdmin && (
        <RoleAccessPanel
          cafeId={cafeId}
          canManage={isAdmin}
          initialOverview={roleOverview}
        />
      )}

      <CashManagementPanel
        cafeId={cafeId}
        canManage={myRole === 'owner' || myRole === 'manager'}
        initialEnabled={cashEnabled}
      />

      <KotPrintingPanel
        cafeId={cafeId}
        timezone={timezone}
        canManage={myRole === "owner" || myRole === "manager"}
        initialEnabled={printing.enabled}
        initialPrinters={printing.printers}
        initialStations={printing.stations}
        initialTokens={printing.tokens}
      />
    </div>
  )
}
