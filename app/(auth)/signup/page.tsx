'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SignupPage() {
  // useSearchParams needs a Suspense boundary for the static shell (Next build rule).
  return (
    <Suspense fallback={<div className="h-64" aria-hidden />}>
      <SignupForm />
    </Suspense>
  )
}

function SignupForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  // /signup is deliberately unlinked from every marketing page (those go
  // through /get-started's lead-only path) but had no gate of its own — a
  // visitor who knew the URL could self-register directly. An invite is
  // issued from the ops Leads console once a lead is actually approved, and
  // is bound to one specific email — resolved here before any form renders.
  // Lazy-initialized from the URL directly — "no token" is knowable at the
  // very first render, so it belongs in the initial state, not set inside
  // an effect (which would trigger an avoidable extra render).
  const [invite, setInvite] = useState<'checking' | 'valid' | 'invalid'>(token ? 'checking' : 'invalid')
  const [inviteError, setInviteError] = useState<string | null>(
    token ? null : 'This is an invite-only signup link — the link you used is missing its invite code.',
  )

  const [step, setStep] = useState<'details' | 'code'>('details')
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm_password: '' })
  const [agreed, setAgreed] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    // Same reasoning as /login: arriving here should always be a clean
    // slate, not a continuation of whatever account was signed in before.
    void createClient().auth.signOut()
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/auth/signup/validate-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok) {
        setInvite('invalid')
        setInviteError(body.error ?? 'This signup link is not valid.')
        return
      }
      // The email is locked to whatever the invite was issued for — never
      // typed by the visitor — so a forwarded/leaked link can't be used to
      // register a different account than the one actually approved.
      setForm((f) => ({ ...f, email: body.email ?? '' }))
      setInvite('valid')
    })()
    return () => { cancelled = true }
  }, [token])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function requestCode() {
    const res = await fetch('/api/auth/signup/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.email.trim().toLowerCase(), token }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Could not send the verification code.')
  }

  async function onSubmitDetails(e: React.FormEvent) {
    e.preventDefault()
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.')
      return
    }
    if (!agreed) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await requestCode()
      setStep('code')
      setNotice(`We sent a verification code to ${form.email}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const email = form.email.trim().toLowerCase()
      const res = await fetch('/api/auth/signup/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email, code, full_name: form.full_name, phone: form.phone, password: form.password, token,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'That code is not correct.')

      const supabase = createClient()
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email, password: form.password,
      })
      if (signInErr) throw signInErr

      router.push('/onboarding')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function resendCode() {
    setResending(true)
    setError(null)
    try {
      await requestCode()
      setNotice(`We sent a new code to ${form.email}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResending(false)
    }
  }

  if (invite === 'checking') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Checking your invite…</h1>
      </div>
    )
  }

  if (invite === 'invalid') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Invite-only signup</h1>
        <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
          {inviteError}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Registration isn&apos;t open to the public — if you&apos;re interested in KhaoPiyo,{' '}
          <Link href="/get-started" className="font-medium text-primary hover:underline">
            tell us about your café
          </Link>{' '}
          and we&apos;ll follow up.
        </p>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    )
  }

  if (step === 'code') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Check your email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the 6-character code we sent to <span className="font-medium text-foreground">{form.email}</span>.
        </p>

        <form onSubmit={onSubmitCode} className="mt-8 space-y-4">
          <Input
            label="Verification code"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            hint="Expires 10 minutes after it was sent."
          />
          {error && (
            <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-[var(--radius)] bg-success-subtle px-3 py-2 text-[13px] text-success">
              {notice}
            </p>
          )}
          <Button type="submit" size="lg" loading={loading} disabled={code.length < 6} className="w-full">
            Verify &amp; create account
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => { setStep('details'); setError(null); setNotice(null) }}
            className="text-muted-foreground hover:text-foreground"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={resendCode}
            disabled={resending}
            className="font-medium text-primary hover:underline disabled:opacity-50"
          >
            {resending ? 'Sending…' : 'Resend code'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Step 1 of registration — your details. Café setup comes next.
      </p>

      <form onSubmit={onSubmitDetails} className="mt-8 space-y-4">
        <Input label="Full name" name="full_name" required value={form.full_name} onChange={set('full_name')} />
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          readOnly
          disabled
          value={form.email}
          onChange={set('email')}
          hint="Locked to the email your invite was sent to."
        />
        <Input label="Mobile number" name="phone" type="tel" inputMode="numeric" value={form.phone} onChange={set('phone')} />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters."
          value={form.password}
          onChange={set('password')}
        />
        <Input
          label="Confirm password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          value={form.confirm_password}
          onChange={set('confirm_password')}
        />
        <label className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          />
          <span>
            I agree to the{' '}
            <Link href="/legal/terms" target="_blank" className="font-medium text-primary hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" target="_blank" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {error && (
          <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Continue
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
