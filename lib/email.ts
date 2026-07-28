// Server-only email provider abstraction. Credentials live only in server
// env; this file must never be imported client-side.
//
// Without RESEND_API_KEY/EMAIL_FROM configured, every send returns a clear
// failure rather than pretending success — same posture as lib/sms.ts.
import { Resend } from 'resend'

export type EmailResult = { ok: boolean; error?: string }

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  if (!emailConfigured()) {
    return {
      ok: false,
      error: 'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM in server environment variables.',
    }
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject,
      html,
      text,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function wrapper(bodyHtml: string) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
    <p style="font-size:13px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#C2410C;margin:0 0 16px">KhaoPiyo</p>
    ${bodyHtml}
  </div>`
}

export function signupCodeEmail(code: string) {
  return {
    subject: `${code} is your KhaoPiyo verification code`,
    text: `${code} is your KhaoPiyo verification code. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: wrapper(`
      <p style="font-size:14px;color:#555;margin:0 0 8px">Your verification code</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${code}</p>
      <p style="font-size:13px;color:#888;margin:0">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
    `),
  }
}

export function planExpiryReminderEmail(cafeName: string, planName: string, expiresOn: string, daysLeft: number) {
  return {
    subject: `${cafeName}'s KhaoPiyo plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    text: `Your ${planName} plan for ${cafeName} on KhaoPiyo expires on ${expiresOn}. Renew from your café's Billing page to avoid any interruption to billing, QR ordering, or the kitchen display.`,
    html: wrapper(`
      <p style="font-size:15px;margin:0 0 12px">Your <strong>${planName}</strong> plan for <strong>${cafeName}</strong> expires on <strong>${expiresOn}</strong> — ${daysLeft} day${daysLeft === 1 ? '' : 's'} from now.</p>
      <p style="font-size:14px;color:#555;margin:0 0 16px">Renew from your café's Billing page to avoid any interruption to billing, QR ordering, or the kitchen display.</p>
    `),
  }
}
