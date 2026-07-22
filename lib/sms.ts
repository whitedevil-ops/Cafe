// Server-only SMS provider abstraction. Credentials live only in server env;
// this file must never be imported client-side.
//
// Without SMS_PROVIDER configured, every send returns a clear failure rather
// than pretending success — the sms_log records it, staff see "not delivered",
// and OTP verification honestly reports that no code could be sent.

export type SmsResult = { ok: boolean; provider: string; error?: string }

export function smsConfigured(): boolean {
  const provider = process.env.SMS_PROVIDER
  if (provider === 'msg91') return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID)
  if (provider === 'twilio') {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
    )
  }
  return false
}

export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  const provider = process.env.SMS_PROVIDER
  if (!provider) {
    return {
      ok: false,
      provider: 'none',
      error: 'SMS provider not configured. Set SMS_PROVIDER and its credentials in server environment variables.',
    }
  }

  // Indian numbers are stored as 10 digits; providers want E.164.
  const digits = phone.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `+91${digits}` : `+${digits}`

  try {
    if (provider === 'msg91') return await sendViaMsg91(digits, message)
    if (provider === 'twilio') return await sendViaTwilio(e164, message)
    return { ok: false, provider, error: `Unknown SMS provider "${provider}".` }
  } catch (e) {
    return { ok: false, provider, error: (e as Error).message }
  }
}

async function sendViaMsg91(tenDigit: string, message: string): Promise<SmsResult> {
  const authKey = process.env.MSG91_AUTH_KEY
  const sender = process.env.MSG91_SENDER_ID
  if (!authKey || !sender) {
    return { ok: false, provider: 'msg91', error: 'MSG91_AUTH_KEY and MSG91_SENDER_ID must both be set.' }
  }

  const res = await fetch('https://api.msg91.com/api/v2/sendsms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authkey: authKey },
    body: JSON.stringify({
      sender,
      route: '4', // transactional
      country: '91',
      sms: [{ message, to: [tenDigit] }],
    }),
  })

  const body = await res.text()
  if (!res.ok) return { ok: false, provider: 'msg91', error: `HTTP ${res.status}: ${body.slice(0, 200)}` }

  // MSG91 returns 200 with {"type":"error"} on some failures, so status alone is not proof.
  try {
    const parsed = JSON.parse(body) as { type?: string; message?: string }
    if (parsed.type && parsed.type !== 'success') {
      return { ok: false, provider: 'msg91', error: parsed.message ?? body.slice(0, 200) }
    }
  } catch {
    // Non-JSON 200 is MSG91's older request-id response — treat as sent.
  }
  return { ok: true, provider: 'msg91' }
}

async function sendViaTwilio(e164: string, message: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (!sid || !token || !from) {
    return {
      ok: false,
      provider: 'twilio',
      error: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER must all be set.',
    }
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: e164, From: from, Body: message }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, provider: 'twilio', error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  }
  return { ok: true, provider: 'twilio' }
}

export function billSmsText(cafeName: string, code: string, total: number, method: string, billUrl: string) {
  return `${cafeName}\nOrder #${code}\nTotal: Rs${total}\nPayment: ${method}\nThank you for visiting!\nBill: ${billUrl}`
}

export function otpSmsText(cafeName: string, code: string) {
  return `${code} is your verification code for viewing your order history at ${cafeName}. Valid for 10 minutes. Do not share it with anyone.`
}
