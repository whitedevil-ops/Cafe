import { NextResponse } from 'next/server'
import { sendEmail, emailConfigured } from '@/lib/email'

// TEMPORARY — diagnosing why Resend sends are failing in production.
// Returns only the raw provider error + which env vars are present, never
// the key itself. Delete once email delivery is confirmed working.
export async function GET() {
  const hasKey = Boolean(process.env.RESEND_API_KEY)
  const from = process.env.EMAIL_FROM ?? null
  if (!emailConfigured()) {
    return NextResponse.json({ configured: false, hasKey, from })
  }
  const result = await sendEmail(
    'originalblockbuster04@gmail.com',
    'KhaoPiyo email test',
    '<p>test</p>',
    'test',
  )
  return NextResponse.json({ configured: true, hasKey, from, result })
}
