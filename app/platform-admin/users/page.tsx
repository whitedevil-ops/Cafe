import { createClient } from '@/utils/supabase/server'
import { formatDate } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

type Row = { id: string; full_name: string | null; email: string | null; phone: string | null; created_at: string }

export default async function PlatformUsers() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, created_at')
    .order('created_at', { ascending: false })

  const users = (data ?? []) as Row[]

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {users.length} platform {users.length === 1 ? 'user' : 'users'}.
      </p>

      {users.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">No users yet.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-left text-[13px] text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-surface-subtle">
                  <td className="px-4 py-3 font-medium text-foreground">{u.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(u.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
