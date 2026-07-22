'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    // The reset link's PASSWORD_RECOVERY event fires once the client parses the
    // link's token — but if it already fired before this listener attached,
    // fall back to checking for a session directly.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })

    // If neither the event nor an existing session showed up in time, the
    // link was bad — but the render guard below (`invalid && !ready`) means
    // this is a no-op if `ready` already flipped true by then.
    const timeout = setTimeout(() => setInvalid(true), 2500)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

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

  if (invalid && !ready) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Link expired or invalid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This reset link didn&apos;t work — it may have expired or already been used.
        </p>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="font-medium text-primary hover:underline">Request a new link</Link>
        </p>
      </div>
    )
  }

  if (!ready) {
    return <div className="h-64" aria-hidden />
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
