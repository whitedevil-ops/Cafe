'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Replaces the old "tap Start, register yourself" flow. This form only ever
// creates a lead (submit_lead RPC, via /api/leads/submit) — never an
// account. A real person on our side follows up and decides whether/how to
// get the café onboarded. /signup (OTP self-serve) still exists and still
// works for that follow-up step; it's just no longer linked from marketing
// pages.
export default function GetStartedPage() {
  const [form, setForm] = useState({ full_name: '', phone: '', business_name: '', city: '', email: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/leads/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Something went wrong — please try again.')
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Thanks, {form.full_name.split(' ')[0]}!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;ve got your details — our team will reach out on {form.phone} shortly to get your café set up.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          &larr; Back to home
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Let&apos;s get you started</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us a bit about your café and we&apos;ll reach out to set you up.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Input label="Full name" name="full_name" required value={form.full_name} onChange={set('full_name')} />
        <Input label="Mobile number" name="phone" type="tel" inputMode="numeric" required value={form.phone} onChange={set('phone')} />
        <Input label="Café / restaurant name" name="business_name" value={form.business_name} onChange={set('business_name')} />
        <Input label="City" name="city" value={form.city} onChange={set('city')} />
        <Input label="Email" name="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        <div className="space-y-1.5">
          <label htmlFor="message" className="block text-[13px] font-medium text-foreground">Anything else?</label>
          <textarea
            id="message"
            name="message"
            rows={3}
            value={form.message}
            onChange={set('message')}
            className="w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        {error && (
          <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Request a callback
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
