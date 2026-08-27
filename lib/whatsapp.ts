// Server-only WhatsApp Cloud API sender. Credentials live only in server env;
// this file must never be imported client-side.
//
// Mirrors lib/sms.ts's shape and philosophy: without the required env vars,
// every send returns a clear failure rather than pretending success — the
// whatsapp_log records it, staff see "not delivered", and can retry once
// configured.
//
// Both messages below are business-initiated, never inside a customer's
// active 24-hour WhatsApp session, so the Cloud API requires each go out as a
// pre-approved message TEMPLATE — free-form text is rejected outside that
// window. The *_TEMPLATE_NAME/_TEMPLATE_LANG env vars point at whichever
// template Meta has approved; the body/button parameters below must be kept
// in sync with that template's variable order — Meta returns a clear API
// error (captured into whatsapp_logs.error) if they drift out of sync.

export type WhatsAppResult = { ok: boolean; error?: string }

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

async function sendTemplate(
  templateName: string,
  templateLang: string,
  phone: string,
  bodyParams: string[],
  buttonParam: string,
): Promise<WhatsAppResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      error: 'WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in server environment variables.',
    }
  }

  // Indian numbers are stored as 10 digits; Cloud API wants country code with
  // no leading "+".
  const digits = phone.replace(/\D/g, '')
  const to = digits.length === 10 ? `91${digits}` : digits

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLang },
          components: [
            { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonParam }] },
          ],
        },
      }),
    })

    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    if (!res.ok) {
      const message = body?.error?.message ?? `HTTP ${res.status}`
      return { ok: false, error: message.slice(0, 200) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Button's dynamic URL variable is the part appended after the template's
// fixed prefix (set in Meta to "https://khaopiyo.ventron.in/r/") — send just
// the receipt_token, not the full URL.
function receiptTokenFrom(billUrl: string): string {
  return billUrl.split('/r/')[1]?.split('?')[0] ?? ''
}

export async function sendWhatsAppOrderPlaced(
  phone: string,
  cafeName: string,
  code: string,
  total: number,
  billUrl: string,
): Promise<WhatsAppResult> {
  const templateName = process.env.WHATSAPP_ORDER_TEMPLATE_NAME || 'khaopiyo_order_placed'
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || 'en'
  return sendTemplate(templateName, templateLang, phone, [cafeName, `#${code}`, `Rs${total}`], receiptTokenFrom(billUrl))
}

export async function sendWhatsAppBill(
  phone: string,
  cafeName: string,
  code: string,
  total: number,
  billUrl: string,
): Promise<WhatsAppResult> {
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'khaopiyo'
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || 'en'
  return sendTemplate(templateName, templateLang, phone, [cafeName, `#${code}`, `Rs${total}`], receiptTokenFrom(billUrl))
}
