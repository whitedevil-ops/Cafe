'use client'

import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'

export default function WhatsAppBillingPanel({
  cafeId,
  canManage,
  entitled,
  initialEnabled,
}: {
  cafeId: string
  canManage: boolean
  /** Whether the café's plan includes whatsapp_bills at all (Growth/Scale) —
   * separate from the toggle below, which only controls whether an entitled
   * café is currently using it. */
  entitled: boolean
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const { toast } = useToast()

  async function toggle(next: boolean) {
    setEnabled(next)
    const supabase = createClient()
    const { error } = await supabase.from('cafes').update({ whatsapp_bills_enabled: next }).eq('id', cafeId)
    if (error) {
      setEnabled(!next)
      return toast(error.message, 'error')
    }
    toast(next ? 'WhatsApp bill sending turned on.' : 'WhatsApp bill sending turned off.')
  }

  return (
    <section className="mt-10 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <MessageCircle size={17} /> WhatsApp bill sending
          </h2>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            Sends an order confirmation when an order is placed, and the bill when it&apos;s paid — automatically,
            no staff action needed.
          </p>
        </div>
        {entitled ? (
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="WhatsApp bill sending"
            disabled={!canManage}
            onClick={() => toggle(!enabled)}
            className={`h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-primary' : 'bg-surface-subtle border border-border-strong'}`}
          >
            <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        ) : (
          <span className="shrink-0 rounded-full bg-surface-subtle px-3 py-1 text-[12px] font-medium text-muted-foreground">
            Growth &amp; Scale plans
          </span>
        )}
      </div>

      {!entitled && (
        <p className="mt-4 rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Not on your current plan — upgrade to Growth or Scale to send bills over WhatsApp.
        </p>
      )}

      {entitled && !enabled && (
        <p className="mt-4 rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Off — customers won&apos;t receive WhatsApp messages for orders or bills.
        </p>
      )}
    </section>
  )
}
