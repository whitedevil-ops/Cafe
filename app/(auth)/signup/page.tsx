'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name, phone: form.phone } },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    // If email confirmation is on, there's no session yet — tell the user to verify.
    if (!data.session) {
      setNotice('Check your email to confirm your account, then sign in.')
      setLoading(false)
      return
    }
    router.push('/onboarding')
    router.refresh()
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Step 1 of registration — your details. Café setup comes next.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Input label="Full name" name="full_name" required value={form.full_name} onChange={set('full_name')} />
        <Input label="Email" name="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
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
