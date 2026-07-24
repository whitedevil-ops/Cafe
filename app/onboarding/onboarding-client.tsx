'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type OnboardingDraft = {
  id: string
  onboarding_step: string
  name: string | null
  business_type: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  country: string | null
  gst_registered: boolean | null
  legal_name: string | null
  gstin: string | null
  dine_in: boolean | null
  takeaway: boolean | null
  onboarding_meta: { menu_choice?: string } | null
} | null

const BUSINESS_TYPES = [
  ['cafe', 'Café'],
  ['restaurant', 'Restaurant'],
  ['qsr', 'QSR'],
  ['bakery', 'Bakery'],
  ['cloud_kitchen', 'Cloud Kitchen'],
  ['food_court', 'Food Court Outlet'],
  ['other', 'Other'],
] as const

type Step = 'details' | 'setup' | 'ready'
type MenuChoice = 'import' | 'manual' | 'later'

function Progress({ step }: { step: Step }) {
  const segments = [
    { key: 'account', label: 'Account', done: true },
    { key: 'details', label: 'Café', done: step !== 'details' },
    { key: 'setup', label: 'Setup', done: step === 'ready' },
    { key: 'ready', label: 'Ready', done: false },
  ]
  return (
    <div className="mb-8 flex items-center">
      {segments.map((s, i) => (
        <div key={s.key} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={`grid h-2.5 w-2.5 place-items-center rounded-full ${
                s.done || (s.key === 'details' && step === 'details') || (s.key === 'setup' && step === 'setup') || (s.key === 'ready' && step === 'ready')
                  ? 'bg-primary'
                  : 'bg-border-strong'
              }`}
            />
            <span className="text-[11px] font-medium text-muted-foreground">{s.label}</span>
          </div>
          {i < segments.length - 1 && <div className={`mx-2 h-px flex-1 ${s.done ? 'bg-primary' : 'bg-border'}`} />}
        </div>
      ))}
    </div>
  )
}

export default function OnboardingClient({ draft }: { draft: OnboardingDraft }) {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState<Step>(draft?.onboarding_step === 'details' ? 'setup' : 'details')
  const [cafeId, setCafeId] = useState<string | null>(draft?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // ── Step 1: Café Details ───────────────────────────────────────────────
  const [details, setDetails] = useState({
    name: draft?.name ?? '',
    business_type: draft?.business_type ?? 'cafe',
    phone: draft?.phone ?? '',
    email: draft?.email ?? '',
    address: draft?.address ?? '',
    city: draft?.city ?? '',
    state: draft?.state ?? '',
    pincode: draft?.pincode ?? '',
    gst_registered: draft?.gst_registered ?? false,
    legal_name: draft?.legal_name ?? '',
    gstin: draft?.gstin ?? '',
  })
  const setD = (k: keyof typeof details) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDetails((f) => ({ ...f, [k]: e.target.value }))

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('create_or_resume_onboarding_cafe', {
      p_name: details.name,
      p_business_type: details.business_type,
      p_phone: details.phone,
      p_email: details.email || null,
      p_address: details.address || null,
      p_city: details.city || null,
      p_state: details.state || null,
      p_pincode: details.pincode || null,
      p_country: 'IN',
      p_gst_registered: details.gst_registered,
      p_legal_name: details.gst_registered ? details.legal_name : null,
      p_gstin: details.gst_registered ? details.gstin : null,
    })
    setLoading(false)
    if (err) {
      if (err.message.includes('plan_limit_reached')) {
        setError('Your current plan doesn’t allow another café. Upgrade your plan to add one.')
      } else {
        setError(err.message)
      }
      return
    }
    setCafeId((data as { cafe_id: string }).cafe_id)
    setStep('setup')
  }

  // ── Step 2: Operations + Business Setup (combined — keeps the wizard to
  //    3 short screens rather than one giant form, without over-splitting
  //    two genuinely small steps into their own full pages) ───────────────
  const [dineIn, setDineIn] = useState(draft?.dine_in ?? true)
  const [takeaway, setTakeaway] = useState(draft?.takeaway ?? true)
  const [floors, setFloors] = useState<string[]>(['Ground Floor'])
  const [skipFloors, setSkipFloors] = useState(false)
  const [approxTables, setApproxTables] = useState('')
  const [staffCount, setStaffCount] = useState('')
  const [ordersPerDay, setOrdersPerDay] = useState('')
  const [menuChoice, setMenuChoice] = useState<MenuChoice>('later')

  function addFloor() {
    setFloors((f) => [...f, ''])
  }
  function updateFloor(i: number, v: string) {
    setFloors((f) => f.map((x, idx) => (idx === i ? v : x)))
  }
  function removeFloor(i: number) {
    setFloors((f) => f.filter((_, idx) => idx !== i))
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault()
    if (!dineIn && !takeaway) {
      setError('Enable at least one way to serve customers.')
      return
    }
    if (!cafeId) return
    setLoading(true)
    setError(null)

    const { error: cafeErr } = await supabase
      .from('cafes')
      .update({
        dine_in: dineIn,
        takeaway,
        onboarding_meta: { approx_tables: approxTables || null, staff_count: staffCount || null, orders_per_day: ordersPerDay || null, menu_choice: menuChoice },
        onboarding_step: 'complete',
      })
      .eq('id', cafeId)
    if (cafeErr) {
      setLoading(false)
      setError(cafeErr.message)
      return
    }

    if (dineIn && !skipFloors) {
      const areas = floors.map((name, i) => ({ name: name.trim() || `Floor ${i + 1}`, sort: i, archived: false }))
      if (areas.length > 0) {
        const { error: floorErr } = await supabase.rpc('save_floor_layout', { p_cafe_id: cafeId, p_areas: areas, p_tables: [] })
        if (floorErr) {
          setLoading(false)
          setError(floorErr.message)
          return
        }
      }
    }

    setLoading(false)
    setStep('ready')
  }

  function openKhaoPiyo() {
    if (menuChoice === 'import') router.push('/dashboard/menu?import=1')
    else if (menuChoice === 'manual') router.push('/dashboard/menu')
    else router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-16">
      <Progress step={step} />

      {step === 'details' && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tell us about your café</h1>
          <p className="mt-1 text-sm text-muted-foreground">This creates your private workspace. You can refine everything later in settings.</p>

          <form onSubmit={submitDetails} className="mt-8 space-y-4">
            <Input label="Café / Restaurant name" required value={details.name} onChange={setD('name')} />

            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-foreground">Business type</label>
              <select
                value={details.business_type}
                onChange={setD('business_type')}
                className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
              >
                {BUSINESS_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            <Input label="Business phone" type="tel" inputMode="numeric" required value={details.phone} onChange={setD('phone')} />
            <Input label="Business email (optional)" type="email" value={details.email} onChange={setD('email')} />
            <Input label="Address" required value={details.address} onChange={setD('address')} />

            <div className="grid grid-cols-2 gap-3">
              <Input label="City" required value={details.city} onChange={setD('city')} />
              <Input label="State" required value={details.state} onChange={setD('state')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="PIN code" required value={details.pincode} onChange={setD('pincode')} />
              <Input label="Country" value="India" disabled readOnly />
            </div>

            <div className="rounded-[var(--radius)] border border-border-strong p-3">
              <p className="text-[13px] font-medium text-foreground">GST registered?</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDetails((f) => ({ ...f, gst_registered: true }))}
                  className={`flex-1 rounded-[var(--radius-sm)] border py-2 text-[13px] font-medium ${details.gst_registered ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setDetails((f) => ({ ...f, gst_registered: false }))}
                  className={`flex-1 rounded-[var(--radius-sm)] border py-2 text-[13px] font-medium ${!details.gst_registered ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
                >
                  No
                </button>
              </div>
              {details.gst_registered && (
                <div className="mt-3 space-y-3">
                  <Input label="Legal business name" value={details.legal_name} onChange={setD('legal_name')} />
                  <Input label="GSTIN" value={details.gstin} onChange={setD('gstin')} />
                </div>
              )}
            </div>

            {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}
            <Button type="submit" size="lg" loading={loading} className="w-full">Continue</Button>
          </form>
        </div>
      )}

      {step === 'setup' && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">How do you serve customers?</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enable at least one — you can change this anytime in settings.</p>

          <form onSubmit={submitSetup} className="mt-8 space-y-5">
            <div className="flex gap-2">
              <button type="button" onClick={() => setDineIn((v) => !v)} className={`flex-1 rounded-[var(--radius)] border py-2.5 text-[13px] font-medium ${dineIn ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}>
                Dine-In
              </button>
              <button type="button" onClick={() => setTakeaway((v) => !v)} className={`flex-1 rounded-[var(--radius)] border py-2.5 text-[13px] font-medium ${takeaway ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}>
                Takeaway
              </button>
              <span className="flex flex-1 items-center justify-center rounded-[var(--radius)] border border-border-strong py-2.5 text-[13px] font-medium text-muted-foreground">
                QR ordering ✓
              </span>
            </div>

            {dineIn && !skipFloors && (
              <div className="rounded-[var(--radius)] border border-border-strong p-3">
                <p className="text-[13px] font-medium text-foreground">Floors / areas</p>
                <div className="mt-2 space-y-2">
                  {floors.map((f, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={f}
                        onChange={(e) => updateFloor(i, e.target.value)}
                        placeholder={`e.g. Ground Floor`}
                        className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
                      />
                      {floors.length > 1 && (
                        <button type="button" onClick={() => removeFloor(i)} className="px-2 text-[13px] text-muted-foreground hover:text-destructive">Remove</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" onClick={addFloor} className="text-[13px] font-medium text-primary hover:underline">+ Add another floor</button>
                  <button type="button" onClick={() => setSkipFloors(true)} className="text-[13px] text-muted-foreground hover:underline">Set up later</button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <Input label="Approx. tables" type="number" min={0} value={approxTables} onChange={(e) => setApproxTables(e.target.value)} />
              <Input label="Staff" type="number" min={0} value={staffCount} onChange={(e) => setStaffCount(e.target.value)} />
              <Input label="Orders/day" type="number" min={0} value={ordersPerDay} onChange={(e) => setOrdersPerDay(e.target.value)} />
            </div>

            <div>
              <p className="text-[13px] font-medium text-foreground">How would you like to add your menu?</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {([
                  ['import', 'Import Excel/CSV'],
                  ['manual', 'Add manually'],
                  ['later', 'Do this later'],
                ] as const).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMenuChoice(v)}
                    className={`rounded-[var(--radius)] border py-2 text-[12.5px] font-medium ${menuChoice === v ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}
            <Button type="submit" size="lg" loading={loading} className="w-full">Continue</Button>
          </form>
        </div>
      )}

      {step === 'ready' && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">You&apos;re ready to start with KhaoPiyo.</h1>
          <ul className="mt-6 space-y-2 text-[14px] text-foreground">
            <li className="flex items-center gap-2"><span className="text-success">✓</span> Café created</li>
            <li className="flex items-center gap-2"><span className="text-success">✓</span> Owner account created</li>
            <li className="flex items-center gap-2"><span className="text-success">✓</span> Ordering modes configured</li>
          </ul>
          <p className="mt-4 text-[13px] font-medium text-muted-foreground">Optional remaining — you&apos;ll see these on your dashboard:</p>
          <ul className="mt-2 space-y-1.5 text-[13.5px] text-muted-foreground">
            <li>○ Add menu</li>
            <li>○ Create tables</li>
            <li>○ Configure GST</li>
            <li>○ Add payment methods</li>
            <li>○ Invite staff</li>
            <li>○ Generate QR codes</li>
          </ul>
          <Button size="lg" className="mt-8 w-full" onClick={openKhaoPiyo}>Open KhaoPiyo</Button>
        </div>
      )}
    </div>
  )
}
