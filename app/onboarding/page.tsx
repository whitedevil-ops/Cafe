'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${base || 'cafe'}-${Math.random().toString(36).slice(2, 6)}`
}

export default function OnboardingPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', city: '', tables: '6' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    // 1) Create the café (tenant). RLS "create own" allows owner_id = auth.uid().
    const { data: cafe, error: cafeErr } = await supabase
      .from('cafes')
      .insert({ owner_id: user.id, name: form.name, slug: slugify(form.name), city: form.city })
      .select()
      .single()
    if (cafeErr || !cafe) {
      setError(cafeErr?.message ?? 'Could not create café')
      setLoading(false)
      return
    }

    // 2) Owner membership FIRST and awaited — the settings/tables policies check
    //    is_cafe_member(), so the membership must be committed before those writes.
    const { error: memberErr } = await supabase
      .from('cafe_members')
      .insert({ cafe_id: cafe.id, user_id: user.id, role: 'owner' })
    if (memberErr) {
      setError(memberErr.message)
      setLoading(false)
      return
    }

    // 3) Now membership exists — settings + starter tables can run together.
    const n = Math.max(1, Math.min(50, parseInt(form.tables) || 6))
    const [{ error: settingsErr }, { error: tablesErr }] = await Promise.all([
      supabase.from('cafe_settings').insert({ cafe_id: cafe.id }),
      supabase.from('cafe_tables').insert(
        Array.from({ length: n }, (_, i) => ({
          cafe_id: cafe.id,
          label: String(i + 1),
          token: `${cafe.slug}-t${i + 1}`,
        })),
      ),
    ])
    if (settingsErr || tablesErr) {
      setError((settingsErr ?? tablesErr)!.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-16">
      <p className="text-[13px] font-medium text-primary">Step 2</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
        Set up your café
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This creates your private workspace. You can refine everything later in settings.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Input label="Café name" name="name" required value={form.name} onChange={set('name')} />
        <Input label="City" name="city" value={form.city} onChange={set('city')} />
        <Input
          label="Number of tables"
          name="tables"
          type="number"
          min={1}
          max={50}
          value={form.tables}
          onChange={set('tables')}
          hint="We'll create a QR-ready table for each. Change anytime."
        />
        {error && (
          <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Create café
        </Button>
      </form>
    </div>
  )
}
