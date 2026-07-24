import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import ProfileClient, { type CafeProfile, type Hours } from './profile-client'

export const dynamic = 'force-dynamic'

const DEFAULT_HOURS: Hours = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    { open: '09:00', close: '23:00', closed: false },
  ]),
) as Hours

export default async function CafeProfilePage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data }, { data: settings }] = await Promise.all([
    supabase
      .from('cafes')
      .select('name, description, logo_url, email, phone, website, gstin, gst_sac_code, gst_registered, legal_name, trade_name, state_code, invoice_prefix, tax_inclusive, tax_percent, service_charge, accept_cash, accept_upi_counter, accept_card_counter, accept_pay_counter, online_payments_enabled, razorpay_status, razorpay_key_id, razorpay_webhook_token, address, city, state, pincode, dine_in, takeaway')
      .eq('id', cafe.cafeId)
      .single(),
    supabase.from('cafe_settings').select('hours, receipt').eq('cafe_id', cafe.cafeId).maybeSingle(),
  ])

  const profile: CafeProfile = {
    name: data?.name ?? cafe.name,
    description: data?.description ?? '',
    logo_url: data?.logo_url ?? null,
    email: data?.email ?? '',
    phone: data?.phone ?? '',
    website: data?.website ?? '',
    gstin: data?.gstin ?? '',
    gst_sac_code: data?.gst_sac_code ?? '996331',
    gst_registered: data?.gst_registered ?? false,
    legal_name: data?.legal_name ?? '',
    trade_name: data?.trade_name ?? '',
    state_code: data?.state_code ?? '',
    invoice_prefix: data?.invoice_prefix ?? 'INV',
    tax_inclusive: data?.tax_inclusive ?? false,
    tax_percent: Number(data?.tax_percent ?? 0),
    service_charge: Number(data?.service_charge ?? 0),
    accept_cash: data?.accept_cash ?? true,
    accept_upi_counter: data?.accept_upi_counter ?? true,
    accept_card_counter: data?.accept_card_counter ?? true,
    accept_pay_counter: data?.accept_pay_counter ?? true,
    online_payments_enabled: data?.online_payments_enabled ?? false,
    razorpay_status: (data?.razorpay_status ?? 'not_connected') as 'not_connected' | 'pending' | 'connected' | 'disabled',
    razorpay_key_id: data?.razorpay_key_id ?? null,
    razorpay_webhook_token: data?.razorpay_webhook_token ?? null,
    address: data?.address ?? '',
    city: data?.city ?? '',
    state: data?.state ?? '',
    pincode: data?.pincode ?? '',
    dine_in: data?.dine_in ?? true,
    takeaway: data?.takeaway ?? true,
    receipt_footer:
      ((settings?.receipt as { footer?: string } | null)?.footer ?? '') || '',
  }

  const hours = { ...DEFAULT_HOURS, ...((settings?.hours as Hours | null) ?? {}) }

  return (
    <ProfileClient
      cafeId={cafe.cafeId}
      userId={cafe.userId}
      myRole={cafe.role}
      initial={profile}
      initialHours={hours}
      timezone={cafe.timezone}
    />
  )
}
