// Server-only SMS provider abstraction. No provider is configured yet, and this
// module NEVER pretends otherwise: without SMS_PROVIDER + credentials in server
// env, every send returns a clear failure that gets recorded on the sms_log —
// the UI shows "not delivered", staff can retry once a provider is configured.
// Credentials live only in server env; this file must never be imported client-side.

export type SmsResult = { ok: boolean; provider: string; error?: string }

export async function sendSms(_phone: string, _message: string): Promise<SmsResult> {
  const provider = process.env.SMS_PROVIDER
  if (!provider) {
    return {
      ok: false,
      provider: 'none',
      error: 'SMS provider not configured. Set SMS_PROVIDER and its credentials in server environment variables.',
    }
  }
  // Integration point: add real providers here (e.g. MSG91, Twilio, Fast2SMS).
  return { ok: false, provider, error: `SMS provider "${provider}" is not implemented yet.` }
}

export function billSmsText(cafeName: string, code: string, total: number, method: string, billUrl: string) {
  return `${cafeName}\nOrder #${code}\nTotal: Rs${total}\nPayment: ${method}\nThank you for visiting!\nBill: ${billUrl}`
}
