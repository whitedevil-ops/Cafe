import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'
import { sendEmail, emailConfigured, leadNotificationEmail } from '@/lib/email'

// Public, unauthenticated — this is the entire replacement for "tap Start,
// register yourself". submit_lead() is the only privileged thing it touches
// (SECURITY DEFINER, grants nothing beyond inserting a leads row). Sending
// the notification email is best-effort: the lead is already durably
// stored by the time email is attempted, so a Resend/quota hiccup here must
// never surface as a failure to the visitor who just filled the form.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    full_name?: string
    phone?: string
    email?: string
    business_name?: string
    city?: string
    message?: string
  }
  const full_name = body.full_name?.trim()
  const phone = body.phone?.trim()
  if (!full_name || !phone) {
    return NextResponse.json({ error: 'Name and phone number are required.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: leadId, error } = await supabase.rpc('submit_lead', {
    p_full_name: full_name,
    p_phone: phone,
    p_email: body.email?.trim() || null,
    p_business_name: body.business_name?.trim() || null,
    p_city: body.city?.trim() || null,
    p_message: body.message?.trim() || null,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (emailConfigured() && adminConfigured()) {
    try {
      const admin = createAdminClient()
      const { data: recipients } = await admin.from('lead_notification_emails').select('email')
      const to = (recipients ?? []).map((r) => r.email as string)
      if (to.length > 0) {
        const { subject, html, text } = leadNotificationEmail({
          full_name,
          phone,
          email: body.email,
          business_name: body.business_name,
          city: body.city,
          message: body.message,
        })
        await sendEmail(to, subject, html, text)
      }
    } catch (e) {
      console.error('lead notification email failed', e)
    }
  }

  return NextResponse.json({ ok: true, id: leadId })
}
