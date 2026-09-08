'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary for the static shell (Next build rule).
  return (
    <Suspense fallback={<div className="h-64" aria-hidden />}>
      <ResetPasswordFlow />
    </Suspense>
  )
}

type Stage = 'confirm' | 'checking' | 'form' | 'invalid'

function ResetPasswordFlow() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // The reset email links here with ?token_hash=...&type=recovery — our own
  // page, not Supabase's raw verify URL — specifically so that an email
  // client's automatic link-scanner (Outlook Safe Links, Gmail, corporate
  // gateways — a bot, not the recipient) can visit this URL without spending
  // anything: it's just a GET that renders a button. The token is only
  // single-use-consumed by the explicit verifyOtp() call below, which fires
  // on a real click, not on page load — a plain HTTP-fetching scanner never
  // triggers it. Before this, the email linked straight to Supabase's verify
  // endpoint, so the scanner's own prefetch was consuming the link before
  // the recipient ever clicked it — every reset failed with "expired".
  const tokenHash = searchParams.get('token_hash')
  const otpType = searchParams.get('type')

  const [stage, setStage] = useState<Stage>(tokenHash && otpType === 'recovery' ? 'confirm' : 'checking')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Fallback for the old-style link (#access_token=...&type=recovery,
  // Supabase's implicit flow) — kept in case any email sent before the
  // template switched to token_hash is still sitting unopened in an inbox.
  useEffect(() => {
    if (stage !== 'checking') return
    const supabase = createClient()

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStage('form')
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setStage('form')
    })
    const timeout = setTimeout(() => setStage((s) => (s === 'checking' ? 'invalid' : s)), 2500)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [stage])

  async function confirmToken() {
    if (!tokenHash) return
    setConfirming(true)
    setConfirmError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    setConfirming(false)
    if (error) {
      setConfirmError(error.message)
      setStage('invalid')
      return
    }
    setStage('form')
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')

    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(error.message)
    setDone(true)
    setTimeout(() => router.push('/dashboard'), 1500)
  }

  if (done) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Password updated</h1>
        <p className="mt-2 text-sm text-muted-foreground">Taking you to your dashboard…</p>
      </div>
    )
  }

  if (stage === 'invalid') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Link expired or invalid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {confirmError ?? "This reset link didn't work — it may have expired or already been used."}
        </p>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="font-medium text-primary hover:underline">Request a new link</Link>
        </p>
      </div>
    )
  }

  if (stage === 'checking') {
    return <div className="h-64" aria-hidden />
  }

  if (stage === 'confirm') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reset your password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Confirm it&apos;s you to continue — this link is single-use, so it only activates once you click below.
        </p>
        {confirmError && (
          <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
            {confirmError}
          </p>
        )}
        <Button type="button" size="lg" loading={confirming} onClick={confirmToken} className="mt-8 w-full">
          Continue
        </Button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Set a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Choose a new password for your account.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Input
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="Confirm new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && (
          <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Update password
        </Button>
      </form>
    </div>
  )
}
