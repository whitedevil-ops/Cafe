'use client'

import { useMemo, useState } from 'react'
import { Gift, Award, Users, Lock } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'

export type Reward = { id: string; name: string; points_cost: number; active: boolean; created_at: string }
export type Referral = {
  referrer_name: string | null; referrer_phone: string | null
  referee_name: string | null; referee_phone: string | null
  status: 'pending' | 'rewarded'; reward_amount: number | null
  created_at: string; rewarded_at: string | null
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label="Enabled" disabled={disabled} onClick={onClick}
      className={`h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'}`}
    >
      <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function LoyaltyClient({
  cafeId,
  role,
  initialEnabled,
  initialPointsPer100,
  initialRewards,
  referralAllowed,
  referralPlan,
  initialReferralEnabled,
  initialReferralReward,
  initialReferrals,
}: {
  cafeId: string
  role: string
  initialEnabled: boolean
  initialPointsPer100: number
  initialRewards: Reward[]
  referralAllowed: boolean
  referralPlan: string
  initialReferralEnabled: boolean
  initialReferralReward: number
  initialReferrals: Referral[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const isAdmin = role === 'owner' || role === 'manager'

  const [enabled, setEnabled] = useState(initialEnabled)
  const [pointsPer100, setPointsPer100] = useState(String(initialPointsPer100))
  const [savingSettings, setSavingSettings] = useState(false)

  const [rewards, setRewards] = useState(initialRewards)
  const [rewardName, setRewardName] = useState('')
  const [rewardCost, setRewardCost] = useState('')
  const [savingReward, setSavingReward] = useState(false)
  const [rewardError, setRewardError] = useState<string | null>(null)

  const [adjustPhone, setAdjustPhone] = useState('')
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)

  const [referralEnabled, setReferralEnabled] = useState(initialReferralEnabled)
  const [referralReward, setReferralReward] = useState(String(initialReferralReward))
  const [savingReferral, setSavingReferral] = useState(false)
  const [referrals] = useState(initialReferrals)

  async function saveSettings(nextEnabled: boolean, nextRate: string) {
    setSavingSettings(true)
    const rate = Math.max(0, Math.round(Number(nextRate)) || 0)
    const { error } = await supabase.from('cafes').update({
      loyalty_enabled: nextEnabled,
      loyalty_points_per_100: rate,
    }).eq('id', cafeId)
    setSavingSettings(false)
    if (error) return toast(error.message, 'error')
    toast('Loyalty settings saved.')
  }

  async function toggleEnabled() {
    const next = !enabled
    setEnabled(next)
    await saveSettings(next, pointsPer100)
  }

  async function createReward() {
    const cost = Math.round(Number(rewardCost))
    if (!rewardName.trim()) return setRewardError('Enter a reward name.')
    if (!cost || cost <= 0) return setRewardError('Points cost must be greater than 0.')
    setSavingReward(true)
    setRewardError(null)
    const { data, error } = await supabase.rpc('create_reward', {
      p_cafe_id: cafeId, p_name: rewardName.trim(), p_points_cost: cost,
    })
    setSavingReward(false)
    if (error) return setRewardError(error.message)
    setRewards((list) => [...list, data as Reward].sort((a, b) => a.points_cost - b.points_cost))
    setRewardName('')
    setRewardCost('')
    toast(`Reward "${(data as Reward).name}" created.`)
  }

  async function toggleReward(r: Reward) {
    setRewards((list) => list.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)))
    const { error } = await supabase.rpc('set_reward_active', { p_reward_id: r.id, p_active: !r.active })
    if (error) {
      setRewards((list) => list.map((x) => (x.id === r.id ? { ...x, active: r.active } : x)))
      toast(error.message, 'error')
    }
  }

  async function adjustCustomerPoints() {
    const pts = Math.round(Number(adjustPoints))
    if (!adjustPhone.trim()) return setAdjustError('Enter the customer’s phone number.')
    if (!pts) return setAdjustError('Enter a non-zero number of points.')
    if (!adjustReason.trim()) return setAdjustError('A reason is required.')
    setAdjusting(true)
    setAdjustError(null)
    const { data, error } = await supabase.rpc('adjust_loyalty_points', {
      p_cafe_id: cafeId, p_customer_phone: adjustPhone.trim(), p_points: pts, p_reason: adjustReason.trim(),
    })
    setAdjusting(false)
    if (error) return setAdjustError(error.message)
    const r = data as { new_balance: number }
    toast(`Done — new balance is ${r.new_balance} points.`)
    setAdjustPhone('')
    setAdjustPoints('')
    setAdjustReason('')
  }

  async function saveReferralSettings(nextEnabled: boolean, nextReward: string) {
    setSavingReferral(true)
    const amount = Math.max(0, Math.round(Number(nextReward)) || 0)
    const { error } = await supabase.from('cafes').update({
      referral_enabled: nextEnabled,
      referral_reward_amount: amount,
    }).eq('id', cafeId)
    setSavingReferral(false)
    if (error) return toast(error.message, 'error')
    toast('Referral settings saved.')
  }

  async function toggleReferral() {
    const next = !referralEnabled
    setReferralEnabled(next)
    await saveReferralSettings(next, referralReward)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        title="Loyalty & rewards"
        subtitle="Customers earn points automatically when their bill is paid, and redeem them for rewards you set."
      />

      {!isAdmin && (
        <p className="mt-4 rounded-[var(--radius)] bg-warning-subtle px-3 py-2.5 text-[13px] text-warning">
          View only — your role ({role}) can’t change loyalty settings or rewards.
        </p>
      )}

      <Card className="mt-6">
        <CardHeader title="Program settings" description="Off by default — turn on once you're ready to start earning points on paid orders." />
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-4 py-3">
            <div>
              <p className="text-[13.5px] font-medium text-foreground">Earn points on payment</p>
              <p className="text-[12px] text-muted-foreground">Applies the moment an order is marked paid — never retroactively.</p>
            </div>
            <Toggle on={enabled} disabled={!isAdmin || savingSettings} onClick={toggleEnabled} />
          </div>
          <div className="flex items-end gap-3">
            <Input
              label="Points per ₹100 spent" type="number" min={0} value={pointsPer100}
              onChange={(e) => setPointsPer100(e.target.value)} disabled={!isAdmin}
              hint="E.g. 10 means a ₹250 order earns 25 points."
              className="max-w-[180px]"
            />
            {isAdmin && (
              <Button variant="secondary" size="sm" loading={savingSettings} onClick={() => saveSettings(enabled, pointsPer100)}>
                Save rate
              </Button>
            )}
          </div>
        </div>
      </Card>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader title="Create a reward" description="What a customer can redeem their points for." />
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <Input label="Reward name" value={rewardName} onChange={(e) => setRewardName(e.target.value)} placeholder="Free coffee" className="min-w-[180px] flex-1" />
            <Input label="Points cost" type="number" min={1} value={rewardCost} onChange={(e) => setRewardCost(e.target.value)} className="max-w-[140px]" />
            <Button loading={savingReward} onClick={createReward}>Create</Button>
          </div>
          {rewardError && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{rewardError}</p>}
        </Card>
      )}

      <div className="mt-8">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Rewards</p>
        {rewards.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No rewards yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
                    <Gift size={16} />
                  </div>
                  <div>
                    <p className="text-[13.5px] font-medium text-foreground">{r.name}</p>
                    <p className="text-[12px] text-muted-foreground">{r.points_cost} points</p>
                  </div>
                </div>
                <Toggle on={r.active} disabled={!isAdmin} onClick={() => toggleReward(r)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {isAdmin && (
        <Card className="mt-8">
          <CardHeader title="Adjust a customer's points" description="For goodwill points or fixing a mistake — every adjustment needs a reason and is logged to the audit trail." />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Input label="Customer phone" inputMode="numeric" value={adjustPhone} onChange={(e) => setAdjustPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            <Input label="Points (± )" type="number" value={adjustPoints} onChange={(e) => setAdjustPoints(e.target.value)} placeholder="e.g. 50 or -50" />
            <Input label="Reason" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Service recovery" />
          </div>
          {adjustError && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{adjustError}</p>}
          <Button className="mt-4" variant="secondary" loading={adjusting} onClick={adjustCustomerPoints}>
            <Award size={14} /> Apply adjustment
          </Button>
        </Card>
      )}

      {!referralAllowed ? (
        <Card className="mt-8">
          <div className="flex items-start gap-3 p-1">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-surface-subtle text-muted-foreground">
              <Lock size={16} />
            </div>
            <div>
              <p className="text-[13.5px] font-medium text-foreground">Refer & earn is on the Scale plan</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Your café is on the <span className="font-medium text-foreground">{referralPlan}</span> plan. Customers
                inviting friends for a wallet-credit reward unlocks on Scale.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mt-8">
            <CardHeader title="Refer & earn" description="A customer shares their code. When whoever they invited pays for their first order, both get a wallet credit." />
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border px-4 py-3">
                <div>
                  <p className="text-[13.5px] font-medium text-foreground">Referral program</p>
                  <p className="text-[12px] text-muted-foreground">Off by default. Customers see their code on the Wallet page once this is on.</p>
                </div>
                <Toggle on={referralEnabled} disabled={!isAdmin || savingReferral} onClick={toggleReferral} />
              </div>
              <div className="flex items-end gap-3">
                <Input
                  label="Reward per side (₹)" type="number" min={0} value={referralReward}
                  onChange={(e) => setReferralReward(e.target.value)} disabled={!isAdmin}
                  hint="Both the referrer and the new customer get this amount credited to their wallet."
                  className="max-w-[180px]"
                />
                {isAdmin && (
                  <Button variant="secondary" size="sm" loading={savingReferral} onClick={() => saveReferralSettings(referralEnabled, referralReward)}>
                    Save amount
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="mt-8">
            <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Referral activity</p>
            {referrals.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No referrals yet.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {referrals.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
                        <Users size={16} />
                      </div>
                      <div>
                        <p className="text-[13.5px] font-medium text-foreground">
                          {r.referrer_name ?? 'Unknown'} → {r.referee_name ?? 'Unknown'}
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          {r.status === 'rewarded'
                            ? `Rewarded ₹${r.reward_amount} each`
                            : 'Waiting on the invited customer’s first paid order'}
                        </p>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      r.status === 'rewarded' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'
                    }`}>
                      {r.status === 'rewarded' ? 'Rewarded' : 'Pending'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
