'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { keepSignedIn, setKeepSignedIn, clearStoredSession, shouldSkipLoginSignOut } from '@/lib/desktop-session'

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for the static shell (Next build rule).
  return (
    <Suspense fallback={<div className="h-64" aria-hidden />}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [keepMe, setKeepMe] = useState(true)

  useEffect(() => {
    // Read after mount — localStorage does not exist while this renders on
    // the server, and the box would flicker if it defaulted differently.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKeepMe(keepSignedIn())
  }, [])

  useEffect(() => {
    void (async () => {
      // In the desktop app this same effect fires on every launch: the app
      // opens, lands here, and would sign out the session it is about to
      // restore. A café that asked to stay signed in did not ask for that —
      // arriving here is the app starting, not a request to switch accounts.
      if (await shouldSkipLoginSignOut()) return

      // Otherwise, landing on /login means "let me sign in fresh" — clear any
      // session already in this browser so switching accounts doesn't depend
      // on finding Sign out in the dashboard first, and a saved-password
      // autofill can't silently resume the old account.
      void createClient().auth.signOut()
    })()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    // Recorded before signing in, so the bridge that stores the session sees
    // the café's choice on the very first auth event rather than a tick late.
    setKeepSignedIn(keepMe)
    if (!keepMe) await clearStoredSession()

    const supabase = createClient()
    // A stray trailing space (common from copy-pasting an email out of a chat
    // message) or different casing makes GoTrue treat this as a different
    // account than the one on file — trim/lowercase so it can't silently
    // fail to match a login typed slightly differently than it was created.
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.push(params.get('next') || '/dashboard')
    router.refresh()
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to your café dashboard.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={keepMe}
              onChange={(e) => setKeepMe(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong accent-[var(--primary)]"
            />
            Keep me signed in
          </label>
          <Link href="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <p className="-mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          Stays signed in on this computer until you sign out. Leave it off on a shared or public machine.
        </p>
        {error && (
          <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/get-started" className="font-medium text-primary hover:underline">
          Register your café
        </Link>
      </p>
    </div>
  )
}
