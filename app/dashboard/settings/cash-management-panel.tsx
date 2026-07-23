'use client'

import { useState } from 'react'
import { Banknote } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'

// Optional per café. A card/UPI-heavy counter should not be walked through an
// open-float / count-the-drawer ritual it will never use; a café handling real
// cash volume needs exactly that ritual. Turning it off only hides the
// workflow — no closed shift is ever deleted, because that is a financial
// record.
export default function CashManagementPanel({
  cafeId,
  canManage,
  initialEnabled,
}: {
  cafeId: string
  canManage: boolean
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const { toast } = useToast()

  async function toggle(next: boolean) {
    setEnabled(next)
    const supabase = createClient()
    const { error } = await supabase.from('cafes').update({ cash_management_enabled: next }).eq('id', cafeId)
    if (error) {
      setEnabled(!next)
      return toast(error.message, 'error')
    }
    toast(
      next
        ? 'Cash management on — staff can open and close shifts.'
        : 'Cash management off. Any shift already open can still be closed.',
    )
  }

  return (
    <section className="mt-10 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Banknote size={17} /> Cash management
          </h2>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            Opening float, cash in/out, and end-of-day drawer reconciliation. Leave this off if you take
            mostly card and UPI — the POS and every other screen work exactly the same either way.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Cash management"
          disabled={!canManage}
          onClick={() => toggle(!enabled)}
          className={`h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
            enabled ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'
          }`}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {!enabled && (
        <p className="mt-4 rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Off — no shift needs to be opened before taking orders. Past shift records are kept.
        </p>
      )}
    </section>
  )
}
