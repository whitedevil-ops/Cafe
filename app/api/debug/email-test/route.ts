import { NextResponse } from 'next/server'
import { sendEmail, emailConfigured } from '@/lib/email'

// TEMPORARY — diagnosing why Resend sends are failing in production.
// Returns only the raw provider error + which env vars are present, never
// the key itself. Delete once email delivery is confirmed working.
export async function GET() {
  const hasKey = Boolean(process.env.RESEND_API_KEY)
  const from = process.env.EMAIL_FROM ?? null
  const key = process.env.RESEND_API_KEY ?? ''
  const keyInfo = {
    length: key.length,
    hasNewline: /[\r\n]/.test(key),
    hasLeadingOrTrailingSpace: key !== key.trim(),
    startsWith: key.slice(0, 6),
    endsWith: key.slice(-4),
  }
  const deploy = {
    sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
  }
  if (!emailConfigured()) {
    return NextResponse.json({ configured: false, hasKey, from, keyInfo, deploy })
  }
  const result = await sendEmail(
    'originalblockbuster04@gmail.com',
    'KhaoPiyo email test',
    '<p>test</p>',
    'test',
  )
  return NextResponse.json({ configured: true, hasKey, from, keyInfo, deploy, result })
}
