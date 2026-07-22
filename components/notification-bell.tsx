'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

type Notice = { id: string; type: string; message: string; read: boolean; created_at: string }

export function NotificationBell({ cafeId }: { cafeId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [notices, setNotices] = useState<Notice[]>([])
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, message, read, created_at')
      .eq('cafe_id', cafeId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setNotices(data as Notice[])
  }, [supabase, cafeId])

  useEffect(() => {
    void load()
    const p = setInterval(load, 5000)
    return () => clearInterval(p)
  }, [load])

  const unread = notices.filter((n) => !n.read).length

  async function markAll() {
    setNotices((list) => list.map((n) => ({ ...n, read: true })))
    await supabase.from('notifications').update({ read: true }).eq('cafe_id', cafeId).eq('read', false)
  }

  async function markOne(id: string) {
    setNotices((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)))
    await supabase.from('notifications').update({ read: true }).eq('id', id)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative rounded-[var(--radius)] p-2 text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] rounded-xl border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-medium text-foreground">Notifications</span>
              {unread > 0 && (
                <button onClick={markAll} className="text-[12px] text-primary hover:underline">Mark all read</button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notices.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Nothing yet.</p>
              ) : (
                notices.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => markOne(n.id)}
                    className={`block w-full border-b border-border px-4 py-2.5 text-left text-[13px] last:border-0 hover:bg-surface-subtle ${
                      n.read ? 'text-muted-foreground' : 'font-medium text-foreground'
                    }`}
                  >
                    {n.message}
                    <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      {new Date(n.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
