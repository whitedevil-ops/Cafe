'use client'

import { useEffect, useMemo, useState } from 'react'
import { MoreVertical, UserPlus, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDate, formatDateTime } from '@/lib/datetime'

export type AdminRow = {
  admin_id: string
  user_id: string
  full_name: string
  email: string | null
  role: string
  status: string
  last_login_at: string | null
  created_at: string
}

type AdminDetail = AdminRow & {
  permissions: Record<string, boolean>
  effective_permissions: Record<string, boolean>
  recent_activity: { action: string; target_type: string | null; target_id: string | null; created_at: string }[]
}

const ROLES: { key: string; label: string; blurb: string }[] = [
  { key: 'super_admin', label: 'Super Admin', blurb: 'Full platform control, including managing other admins.' },
  { key: 'operations_admin', label: 'Operations Admin', blurb: 'Cafés, verification, health, and users. No admin management.' },
  { key: 'support_admin', label: 'Support Admin', blurb: 'Read-only café/user lookup for support work.' },
  { key: 'billing_admin', label: 'Billing Admin', blurb: 'Plans and subscriptions only.' },
  { key: 'read_only', label: 'Read Only', blurb: 'Can view permitted information, cannot change anything.' },
]

const PERMISSION_GROUPS: { label: string; keys: { key: string; label: string }[] }[] = [
  { label: 'Cafés', keys: [
    { key: 'cafes.view', label: 'View Cafés' },
    { key: 'cafes.verify', label: 'Verify Cafés' },
    { key: 'cafes.edit', label: 'Edit Cafés' },
    { key: 'cafes.suspend', label: 'Suspend Cafés' },
  ] },
  { label: 'Users & Health', keys: [
    { key: 'users.view', label: 'View Users' },
    { key: 'health.view', label: 'View Health' },
  ] },
  { label: 'Plans & Subscriptions', keys: [
    { key: 'plans.view', label: 'View Plans' },
    { key: 'plans.change', label: 'Change Plans' },
    { key: 'subscriptions.view', label: 'View Subscriptions' },
    { key: 'subscriptions.manage', label: 'Manage Subscriptions' },
  ] },
  { label: 'Audit', keys: [
    { key: 'audit.view', label: 'View Audit Logs' },
  ] },
  { label: 'Admins', keys: [
    { key: 'admins.view', label: 'View Admins' },
    { key: 'admins.create', label: 'Create Admins' },
    { key: 'admins.edit', label: 'Edit Admins' },
    { key: 'admins.disable', label: 'Disable Admins' },
  ] },
  { label: 'Leads', keys: [
    { key: 'leads.view', label: 'View Leads' },
    { key: 'leads.manage', label: 'Manage Notification Emails' },
  ] },
]

const roleLabel = (role: string) => ROLES.find((r) => r.key === role)?.label ?? role

// Mirrors role_default_permissions() in supabase/migrations/0079 exactly —
// lets the Add Admin dialog pre-check the new admin's permissions per role
// without a round trip, and lets submit() send only the keys where the
// creator actually diverged from the role default (a real override), rather
// than pinning every key regardless of whether it matches the role — so a
// later role change on this admin still does something.
const ROLE_DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  super_admin: {
    'cafes.view': true, 'cafes.verify': true, 'cafes.edit': true, 'cafes.suspend': true,
    'users.view': true, 'health.view': true,
    'plans.view': true, 'plans.change': true, 'subscriptions.view': true, 'subscriptions.manage': true,
    'audit.view': true,
    'admins.view': true, 'admins.create': true, 'admins.edit': true, 'admins.disable': true,
    'leads.view': true, 'leads.manage': true,
  },
  operations_admin: {
    'cafes.view': true, 'cafes.verify': true, 'cafes.edit': true, 'cafes.suspend': false,
    'users.view': true, 'health.view': true,
    'plans.view': false, 'plans.change': false, 'subscriptions.view': false, 'subscriptions.manage': false,
    'audit.view': false,
    'admins.view': false, 'admins.create': false, 'admins.edit': false, 'admins.disable': false,
    'leads.view': true, 'leads.manage': false,
  },
  support_admin: {
    'cafes.view': true, 'cafes.verify': false, 'cafes.edit': false, 'cafes.suspend': false,
    'users.view': true, 'health.view': true,
    'plans.view': false, 'plans.change': false, 'subscriptions.view': false, 'subscriptions.manage': false,
    'audit.view': false,
    'admins.view': false, 'admins.create': false, 'admins.edit': false, 'admins.disable': false,
    'leads.view': false, 'leads.manage': false,
  },
  billing_admin: {
    'cafes.view': true, 'cafes.verify': false, 'cafes.edit': false, 'cafes.suspend': false,
    'users.view': false, 'health.view': false,
    'plans.view': true, 'plans.change': true, 'subscriptions.view': true, 'subscriptions.manage': true,
    'audit.view': false,
    'admins.view': false, 'admins.create': false, 'admins.edit': false, 'admins.disable': false,
    'leads.view': false, 'leads.manage': false,
  },
  read_only: {
    'cafes.view': true, 'cafes.verify': false, 'cafes.edit': false, 'cafes.suspend': false,
    'users.view': true, 'health.view': true,
    'plans.view': true, 'plans.change': false, 'subscriptions.view': true, 'subscriptions.manage': false,
    'audit.view': false,
    'admins.view': false, 'admins.create': false, 'admins.edit': false, 'admins.disable': false,
    'leads.view': true, 'leads.manage': false,
  },
}

function PermissionCheckboxes({
  values, onChange,
}: { values: Record<string, boolean>; onChange: (key: string, checked: boolean) => void }) {
  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
          <ul className="mt-1.5 space-y-1">
            {g.keys.map((k) => (
              <li key={k.key}>
                <label className="flex items-center gap-2.5 text-[13.5px] text-foreground">
                  <input
                    type="checkbox"
                    checked={!!values[k.key]}
                    onChange={(e) => onChange(k.key, e.target.checked)}
                    className="h-4 w-4 rounded border-border-strong text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                  />
                  {k.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function AdminsClient({
  initialAdmins,
  permissions,
  selfAdminId,
  selfRole,
}: {
  initialAdmins: AdminRow[]
  permissions: Record<string, boolean>
  selfAdminId: string
  selfRole: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [admins, setAdmins] = useState(initialAdmins)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<AdminRow | null>(null)
  const [permEditing, setPermEditing] = useState<AdminRow | null>(null)
  const [viewing, setViewing] = useState<AdminRow | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)

  async function refresh() {
    const { data } = await supabase.rpc('op_list_admins')
    if (data) setAdmins(data as AdminRow[])
  }

  async function toggleStatus(a: AdminRow) {
    const next = a.status === 'active' ? 'disabled' : 'active'
    const ok = await confirm({
      title: next === 'disabled' ? `Deactivate ${a.full_name}?` : `Activate ${a.full_name}?`,
      description: next === 'disabled' ? 'They will immediately lose access to the platform-admin panel.' : 'They will regain access to the platform-admin panel.',
      confirmLabel: next === 'disabled' ? 'Deactivate' : 'Activate',
      destructive: next === 'disabled',
    })
    if (!ok) return
    const { error } = await supabase.rpc('op_set_admin_status', { p_admin_id: a.admin_id, p_status: next })
    if (error) return toast(error.message, 'error')
    toast(next === 'disabled' ? 'Admin deactivated.' : 'Admin activated.')
    void refresh()
  }

  async function resetPassword(a: AdminRow) {
    const ok = await confirm({
      title: 'Reset password?',
      description: `Sends a secure password-reset link to ${a.email}. No password is ever shown or stored.`,
      confirmLabel: 'Send reset link',
    })
    if (!ok) return
    setResettingId(a.admin_id)
    const res = await fetch('/api/platform-admin/admins/reset-password', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ admin_id: a.admin_id }),
    })
    setResettingId(null)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return toast(body.error ?? 'Could not send reset link.', 'error')
    toast(`Reset link sent to ${body.email}.`)
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admins</h1>
          <p className="mt-1 text-sm text-muted-foreground">{admins.length} platform {admins.length === 1 ? 'admin' : 'admins'}.</p>
        </div>
        {permissions['admins.create'] && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground"
          >
            <UserPlus size={15} /> Add Admin
          </button>
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle text-left text-[12.5px] text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last Login</th>
              <th className="px-4 py-3 font-medium">Created At</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.admin_id} className="border-b border-border last:border-0 hover:bg-surface-subtle">
                <td className="px-4 py-3 font-medium text-foreground">
                  {a.full_name}
                  {a.admin_id === selfAdminId && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{a.email ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[12px] font-medium text-foreground">{roleLabel(a.role)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium capitalize ${a.status === 'active' ? 'bg-success-subtle text-success' : 'bg-surface-subtle text-muted-foreground'}`}>
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{a.last_login_at ? formatDateTime(a.last_login_at) : 'Never'}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(a.created_at)}</td>
                <td className="relative px-4 py-3 text-right">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === a.admin_id ? null : a.admin_id)}
                    aria-label="Actions"
                    className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {openMenuId === a.admin_id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                      <div className="absolute right-4 top-11 z-50 w-52 rounded-[var(--radius-lg)] border border-border bg-surface p-1.5 text-left shadow-[var(--shadow-lg)]">
                        {permissions['admins.view'] && (
                          <MenuItem onClick={() => { setViewing(a); setOpenMenuId(null) }}>View activity</MenuItem>
                        )}
                        {permissions['admins.edit'] && (
                          <MenuItem onClick={() => { setEditing(a); setOpenMenuId(null) }}>Edit admin</MenuItem>
                        )}
                        {permissions['admins.edit'] && a.admin_id !== selfAdminId && (
                          <MenuItem onClick={() => { setPermEditing(a); setOpenMenuId(null) }}>Change permissions</MenuItem>
                        )}
                        {permissions['admins.edit'] && (
                          <MenuItem onClick={() => { setOpenMenuId(null); void resetPassword(a) }} disabled={resettingId === a.admin_id}>
                            {resettingId === a.admin_id ? 'Sending…' : 'Reset password'}
                          </MenuItem>
                        )}
                        {permissions['admins.disable'] && a.admin_id !== selfAdminId && (
                          <MenuItem destructive={a.status === 'active'} onClick={() => { setOpenMenuId(null); void toggleStatus(a) }}>
                            {a.status === 'active' ? 'Deactivate' : 'Activate'}
                          </MenuItem>
                        )}
                      </div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddAdminDialog
          selfRole={selfRole}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); toast('Admin created.'); void refresh() }}
        />
      )}

      {editing && (
        <EditAdminDialog
          admin={editing}
          selfRole={selfRole}
          isSelf={editing.admin_id === selfAdminId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast('Admin updated.'); void refresh() }}
        />
      )}

      {permEditing && (
        <PermissionsDialog
          admin={permEditing}
          supabase={supabase}
          onClose={() => setPermEditing(null)}
          onSaved={() => { setPermEditing(null); toast('Permissions updated.'); void refresh() }}
        />
      )}

      {viewing && (
        <ActivityDialog admin={viewing} supabase={supabase} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

function MenuItem({
  children, onClick, disabled, destructive,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] disabled:opacity-50 ${
        destructive ? 'text-destructive hover:bg-destructive-subtle' : 'text-foreground hover:bg-surface-subtle'
      }`}
    >
      {children}
    </button>
  )
}

function DialogShell({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AddAdminDialog({ selfRole, onClose, onCreated }: { selfRole: string; onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState('support_admin')
  const [permissions, setPermissions] = useState<Record<string, boolean>>(ROLE_DEFAULT_PERMISSIONS.support_admin)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const availableRoles = ROLES.filter((r) => r.key !== 'super_admin' || selfRole === 'super_admin')

  function changeRole(nextRole: string) {
    setRole(nextRole)
    // Reset to the new role's defaults — any custom checkboxes ticked under
    // the old role don't silently carry over as overrides on the new one.
    setPermissions(ROLE_DEFAULT_PERMISSIONS[nextRole] ?? {})
  }

  async function submit() {
    setError(null)
    if (!fullName.trim()) return setError('Full name is required.')
    if (!email.trim()) return setError('Email is required.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirmPassword) return setError('Passwords do not match.')

    // Only send keys where the box actually diverges from the role default —
    // keeps `permissions` a true override set, so changing this admin's role
    // later still changes anything they didn't specifically customize here.
    const roleDefaults = ROLE_DEFAULT_PERMISSIONS[role] ?? {}
    const overrides = Object.fromEntries(
      Object.entries(permissions).filter(([key, value]) => roleDefaults[key] !== value),
    )

    setSubmitting(true)
    const res = await fetch('/api/platform-admin/admins/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName.trim(), email: email.trim(), password, confirm_password: confirmPassword,
        role, permissions: overrides,
      }),
    })
    setSubmitting(false)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return setError(body.error ?? 'Could not create admin.')
    onCreated()
  }

  return (
    <DialogShell title="Add Admin" description="Creates a new platform-admin login." onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label="Full name"><input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} /></Field>
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} /></Field>
        <Field label="Confirm password"><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} /></Field>
        <Field label="Role">
          <select value={role} onChange={(e) => changeRole(e.target.value)} className={inputCls}>
            {availableRoles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <p className="mt-1 text-[12px] text-muted-foreground">{ROLES.find((r) => r.key === role)?.blurb}</p>
        </Field>
        <div>
          <span className="text-[12.5px] font-medium text-muted-foreground">What they can do</span>
          <p className="mt-1 text-[12px] text-muted-foreground">Pre-filled from the role above — tick or untick anything to customize just this admin.</p>
          <div className="mt-2 max-h-64 overflow-y-auto rounded-[var(--radius)] border border-border p-3">
            <PermissionCheckboxes values={permissions} onChange={(key, checked) => setPermissions((v) => ({ ...v, [key]: checked }))} />
          </div>
        </div>
        {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">Cancel</button>
          <button onClick={submit} disabled={submitting} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-primary-foreground disabled:opacity-40">
            {submitting ? 'Creating…' : 'Create admin'}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

function EditAdminDialog({
  admin, selfRole, isSelf, onClose, onSaved,
}: { admin: AdminRow; selfRole: string; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [fullName, setFullName] = useState(admin.full_name)
  const [role, setRole] = useState(admin.role)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const availableRoles = ROLES.filter((r) => r.key !== 'super_admin' || selfRole === 'super_admin' || admin.role === 'super_admin')

  async function submit() {
    setError(null)
    if (!fullName.trim()) return setError('Full name is required.')
    if (isSelf && role !== admin.role) return setError('You cannot change your own role.')

    setSubmitting(true)
    const { error: rpcError } = await supabase.rpc('op_update_admin', { p_admin_id: admin.admin_id, p_full_name: fullName.trim(), p_role: role })
    setSubmitting(false)
    if (rpcError) return setError(rpcError.message)
    onSaved()
  }

  return (
    <DialogShell title="Edit Admin" onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label="Full name"><input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} /></Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf} className={`${inputCls} disabled:opacity-50`}>
            {availableRoles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          {isSelf && <p className="mt-1 text-[12px] text-muted-foreground">You cannot change your own role.</p>}
        </Field>
        {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">Cancel</button>
          <button onClick={submit} disabled={submitting} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-primary-foreground disabled:opacity-40">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

function PermissionsDialog({
  admin, supabase, onClose, onSaved,
}: { admin: AdminRow; supabase: ReturnType<typeof createClient>; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc('op_get_admin_detail', { p_admin_id: admin.admin_id })
      const detail = data as AdminDetail | null
      setValues(detail?.effective_permissions ?? {})
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.admin_id])

  async function submit() {
    setSubmitting(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('op_update_admin_permissions', { p_admin_id: admin.admin_id, p_permissions: values })
    setSubmitting(false)
    if (rpcError) return setError(rpcError.message)
    onSaved()
  }

  return (
    <DialogShell title={`Permissions — ${admin.full_name}`} description={`Base role: ${roleLabel(admin.role)}. Overrides beat the role default.`} onClose={onClose}>
      {loading ? (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-4 space-y-4">
          <PermissionCheckboxes values={values} onChange={(key, checked) => setValues((v) => ({ ...v, [key]: checked }))} />
          {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">Cancel</button>
            <button onClick={submit} disabled={submitting} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-primary-foreground disabled:opacity-40">
              {submitting ? 'Saving…' : 'Save permissions'}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  )
}

function ActivityDialog({ admin, supabase, onClose }: { admin: AdminRow; supabase: ReturnType<typeof createClient>; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<AdminDetail['recent_activity']>([])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc('op_get_admin_detail', { p_admin_id: admin.admin_id })
      const detail = data as AdminDetail | null
      setActivity(detail?.recent_activity ?? [])
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.admin_id])

  return (
    <DialogShell title={`Activity — ${admin.full_name}`} description="Most recent actions taken by this admin, platform-wide." onClose={onClose}>
      <div className="mt-4">
        {loading ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No actions logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((a, i) => (
              <li key={i} className="rounded-[var(--radius)] bg-surface-subtle p-3 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{a.action}</span>
                  <span className="text-[11.5px] text-muted-foreground">{formatDateTime(a.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DialogShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

const inputCls = 'h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13.5px] text-foreground placeholder:text-muted-foreground'
