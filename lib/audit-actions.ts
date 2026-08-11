// Audit actions are stored as machine names (`cafe.status_changed`) because
// that is the right shape for a durable log. Showing them raw in the console
// is not — an operator scanning yesterday's activity should read sentences,
// not identifiers.
//
// Explicitly mapped rather than derived, because the useful phrasing differs
// per action ("Café verified", not "Cafe verified"). Anything unmapped falls
// back to a readable transform instead of disappearing, so an action added in
// a later migration still renders sensibly before anyone updates this file.

export type AuditTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'info'

const LABELS: Record<string, { label: string; tone: AuditTone }> = {
  'cafe.verified': { label: 'Café verified', tone: 'success' },
  'cafe.unverified': { label: 'Verification removed', tone: 'warning' },
  'cafe.status_changed': { label: 'Café status changed', tone: 'warning' },
  'cafe.plan_changed': { label: 'Plan changed', tone: 'info' },
  'cafe.subscription_extended': { label: 'Subscription extended', tone: 'success' },
  'cafe.note_added': { label: 'Note added', tone: 'neutral' },
  'cafe.password_reset_initiated': { label: 'Owner password reset sent', tone: 'warning' },
  'cafe.feature_override_changed': { label: 'Feature override set', tone: 'info' },
  'cafe.feature_override_cleared': { label: 'Feature override cleared', tone: 'neutral' },
  'admin.created': { label: 'Admin created', tone: 'info' },
  'admin.updated': { label: 'Admin updated', tone: 'neutral' },
  'admin.role_changed': { label: 'Admin role changed', tone: 'warning' },
  'admin.permissions_changed': { label: 'Admin permissions changed', tone: 'warning' },
  'admin.status_changed': { label: 'Admin status changed', tone: 'warning' },
  'admin.password_reset_initiated': { label: 'Admin password reset sent', tone: 'destructive' },
  'lead.status_changed': { label: 'Lead status changed', tone: 'neutral' },
}

export function auditLabel(action: string): string {
  const known = LABELS[action]
  if (known) return known.label
  // "cafe.some_new_thing" -> "Cafe some new thing"
  const words = action.replace(/^[a-z]+\./, '').replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function auditTone(action: string): AuditTone {
  return LABELS[action]?.tone ?? 'neutral'
}

/**
 * "3m ago" / "4h ago" / "2d ago". An audit feed is read for recency, and an
 * absolute timestamp makes you do the subtraction yourself. Falls back to
 * nothing beyond a week — at that point the date is the more useful fact and
 * the caller should show that instead.
 */
export function relativeTime(iso: string, now: Date = new Date()): string | null {
  const diffMs = now.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return null

  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days <= 7) return `${days}d ago`
  return null
}
