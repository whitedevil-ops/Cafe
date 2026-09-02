import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured, bridgeSilentAlertEmail } from '@/lib/email'
import { formatDateTime, DEFAULT_TIMEZONE } from '@/lib/datetime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Daily cron (vercel.json). Unlike its siblings under /api/ops this one is NOT
// authorized by an operator session — Vercel Cron calls it with CRON_SECRET,
// exactly like platform-billing/check-expiry. Nothing it sends ever reaches a
// café owner; the audience is the platform operator.
//
// WHY THIS EXISTS: on 2026-09-01 a café printed nothing for a whole day and
// nobody noticed — the bridge was being handed 401 "invalid bridge token" and
// read every rejection as "connected, nothing to print" (fixed in v1.1.8).
// Chasing that down turned up two more cafés whose bridge had NEVER connected
// once, and the only reason anyone found out was someone reading
// print_bridge_tokens by hand. The header badge
// (components/shell/print-bridge-status.tsx) tells café staff. This tells the
// operator, who is the only one left to act when the café itself has not
// noticed for weeks.
//
// Deliberately stateless — no "already alerted" column, so a café that stays
// silent is named again every morning until someone fixes it. An alarm that
// falls quiet on its own after one send would repeat the original bug. That
// stays tolerable only because a fully healthy platform sends nothing at all.

/**
 * How long since the freshest bridge check-in before a café counts as not
 * printing. Far longer than the 2-minute BRIDGE_ONLINE_MS the in-app badge
 * uses: that badge answers "is it printing right now?", while this must not
 * wake an operator over a closed café or a rebooted till. A café shut for a
 * full day still trips it, and that is the trade we want — a wasted "check on
 * them" beats another fortnight of silence.
 */
const STALE_MS = 24 * 60 * 60 * 1000

export async function GET(req: Request) {
  // Fail CLOSED: a missing CRON_SECRET must deny, not skip the check. Same
  // reasoning as platform-billing/check-expiry — an unset env var in the
  // deployed environment would otherwise leave an endpoint that reads every
  // café's bridge state and sends operator mail open to anyone. Never log the
  // secret itself, only the outcome.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url) return NextResponse.json({ error: 'not configured' }, { status: 503 })

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  // Only live cafés with printing switched on. A suspended or archived café
  // not printing is not a fault, and neither is a café that never turned KOT
  // printing on in the first place.
  const { data: cafes, error } = await admin
    .from('cafes')
    .select('id, name')
    .eq('status', 'active')
    .eq('kot_printing_enabled', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!cafes || cafes.length === 0) return NextResponse.json({ ok: true, checked: 0, silent: 0 })

  const { data: tokens, error: tokenError } = await admin
    .from('print_bridge_tokens')
    .select('cafe_id, last_seen_at, created_at')
    .is('revoked_at', null)
    .in('cafe_id', cafes.map((c) => c.id as string))
  if (tokenError) return NextResponse.json({ error: tokenError.message }, { status: 500 })

  const byCafe = new Map<string, { last_seen_at: string | null; created_at: string }[]>()
  for (const t of tokens ?? []) {
    const list = byCafe.get(t.cafe_id as string) ?? []
    list.push({ last_seen_at: t.last_seen_at as string | null, created_at: t.created_at as string })
    byCafe.set(t.cafe_id as string, list)
  }

  const neverConnected: { name: string; detail: string }[] = []
  const wentQuiet: { name: string; detail: string }[] = []
  const now = Date.now()

  for (const cafe of [...cafes].sort((a, b) => (a.name as string).localeCompare(b.name as string))) {
    const paired = byCafe.get(cafe.id as string)
    // Printing on but no bridge paired at all is a half-finished setup, not a
    // failure — the header badge stays hidden for that café for the same
    // reason, and nagging about it daily would be the noise that gets this
    // whole digest filtered away.
    if (!paired || paired.length === 0) continue

    // A café may pair more than one machine; any one of them checking in means
    // tickets are getting out, so the freshest check-in decides — the same
    // rule the header badge and printer_health() already use.
    const lastSeen = paired
      .map((t) => t.last_seen_at)
      .filter((s): s is string => Boolean(s))
      .sort()
      .at(-1)

    // The case that matters most. NULL across every token means this café has
    // never printed one ticket, not that it stopped — a distinction the digest
    // keeps, because "stale" reads like a hiccup and this is not one.
    if (!lastSeen) {
      const pairedOn = paired.map((t) => t.created_at).sort()[0]
      neverConnected.push({
        name: cafe.name as string,
        detail: `paired ${formatDateTime(pairedOn, DEFAULT_TIMEZONE)}, never checked in even once`,
      })
      continue
    }

    const age = now - new Date(lastSeen).getTime()
    if (age > STALE_MS) {
      const days = Math.floor(age / (24 * 60 * 60 * 1000))
      wentQuiet.push({
        name: cafe.name as string,
        detail: `last checked in ${formatDateTime(lastSeen, DEFAULT_TIMEZONE)} — ${days} day${days === 1 ? '' : 's'} ago`,
      })
    }
  }

  const silent = neverConnected.length + wentQuiet.length
  // Send nothing when every café is healthy. A daily "all fine" is how an
  // alert turns into wallpaper, and wallpaper is what this is meant to replace.
  if (silent === 0) return NextResponse.json({ ok: true, checked: cafes.length, silent: 0 })

  if (!emailConfigured()) {
    console.error('bridge-health: cafés are not printing but email is not configured', { silent })
    return NextResponse.json({ ok: true, checked: cafes.length, silent, emailed: 0 })
  }

  // The same operator recipient list the new-lead notification uses
  // (lead_notification_emails, migration 0117): platform-admin editable at
  // /ops/leads, so adding an operator needs no redeploy. It is RLS-locked to
  // RPC access, hence reading it through the service client here.
  const { data: recipients } = await admin.from('lead_notification_emails').select('email')
  const to = (recipients ?? []).map((r) => r.email as string)
  if (to.length === 0) {
    console.error('bridge-health: cafés are not printing but no operator recipients are configured', { silent })
    return NextResponse.json({ ok: true, checked: cafes.length, silent, emailed: 0 })
  }

  // One digest naming every affected café, not one email per café — a stack of
  // near-identical mails is skimmed, and the never-connected line is the one
  // that must not get skimmed past.
  const { subject, html, text } = bridgeSilentAlertEmail(neverConnected, wentQuiet)
  const result = await sendEmail(to, subject, html, text)
  // A silent failure inside the thing built to catch silent failures is the
  // one outcome this route is not allowed to have.
  if (!result.ok) console.error('bridge-health: alert email failed', result.error)

  return NextResponse.json({
    ok: true,
    checked: cafes.length,
    silent,
    never_connected: neverConnected.length,
    went_quiet: wentQuiet.length,
    emailed: result.ok ? to.length : 0,
  })
}
