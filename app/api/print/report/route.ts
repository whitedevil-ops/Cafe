import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

// The bridge reports the outcome of a claimed job here.
//
// A failure recorded through this route only ever marks a PRINT JOB failed.
// It never touches the order, which is already committed and live on the
// digital KDS — that separation is the whole point of the adapter design.
export async function POST(req: NextRequest) {
  const { token, job_id, ok, error: printError } = (await req.json().catch(() => ({}))) as {
    token?: string
    job_id?: string
    ok?: boolean
    error?: string
  }
  if (!token || !job_id || typeof ok !== 'boolean') {
    return NextResponse.json({ error: 'token, job_id and ok are required' }, { status: 400 })
  }

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'print service not configured on the server' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('bridge_report_job', {
    p_token: token,
    p_job_id: job_id,
    p_ok: ok,
    p_error: printError ?? null,
  })

  if (error) return NextResponse.json({ error: 'invalid bridge token' }, { status: 401 })

  return NextResponse.json({ ok: true })
}
