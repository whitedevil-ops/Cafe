'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/datetime'

export type Expense = {
  id: string
  category: string
  amount: number
  vendor: string | null
  method: 'cash' | 'card' | 'upi' | 'split' | 'counter' | null
  notes: string | null
  spent_on: string
  created_at: string
}

const PRESET_CATEGORIES = ['Ingredients', 'Utilities', 'Rent', 'Salaries', 'Maintenance', 'Packaging', 'Other']
const METHODS: { value: Expense['method']; label: string }[] = [
  { value: null, label: 'Unspecified' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
]

function todayLocal() {
  return new Date().toISOString().slice(0, 10)
}

export default function ExpensesClient({
  cafeId,
  initialExpenses,
}: {
  cafeId: string
  initialExpenses: Expense[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [expenses, setExpenses] = useState(initialExpenses)
  const [category, setCategory] = useState(PRESET_CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [vendor, setVendor] = useState('')
  const [method, setMethod] = useState<Expense['method']>(null)
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  async function addExpense() {
    const finalCategory = category === 'Other' ? (customCategory.trim() || 'Other') : category
    const amt = Math.round(Number(amount))
    if (!amt || amt <= 0) return setError('Enter an amount greater than 0.')
    setSaving(true)
    setError(null)
    // Expenses feed net-profit reporting, so they are written through an
    // authorized RPC (owner/manager only, validated + audited). Direct table
    // writes are blocked by RLS since migration 0050.
    const { data, error: err } = await supabase.rpc('record_expense', {
      p_cafe_id: cafeId,
      p_category: finalCategory,
      p_amount: amt,
      p_vendor: vendor.trim() || null,
      p_method: method,
      p_notes: notes.trim() || null,
      p_spent_on: date,
    })
    setSaving(false)
    if (err) return setError(err.message)
    setExpenses((list) => [data as Expense, ...list].sort((a, b) => b.spent_on.localeCompare(a.spent_on)))
    setAmount('')
    setVendor('')
    setNotes('')
    setMethod(null)
    setCustomCategory('')
    toast('Expense logged.')
  }

  async function removeExpense(id: string) {
    setConfirmingDelete(null)
    setExpenses((list) => list.filter((e) => e.id !== id))
    const { error: err } = await supabase.rpc('delete_expense', { p_expense_id: id })
    if (err) toast(err.message, 'error')
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Expenses</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Day-to-day operational spend — not an accounting system, just enough to see real profit in Reports.
      </p>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-foreground">Log an expense</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`min-h-9 rounded-full border px-3 text-[12.5px] font-medium ${category === c ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
            >
              {c}
            </button>
          ))}
        </div>
        {category === 'Other' && (
          <div className="mt-3">
            <Input label="Custom category" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. Repairs" />
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="Amount (₹)" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="Vendor / supplier (optional)" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Local Dairy Co." />
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-foreground">Paid via (optional)</label>
            <select
              value={method ?? ''}
              onChange={(e) => setMethod((e.target.value || null) as Expense['method'])}
              className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
            >
              {METHODS.map((m) => (
                <option key={m.label} value={m.value ?? ''}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Monthly electricity bill" />
        </div>
        {error && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}
        <Button onClick={addExpense} loading={saving} className="mt-4">Add expense</Button>
      </section>

      <div className="mt-8 flex items-center justify-between">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Last 90 days</p>
        <p className="text-sm font-semibold text-foreground">₹{total.toLocaleString('en-IN')}</p>
      </div>

      {expenses.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No expenses logged in this range.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {expenses.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {e.category}
                  {e.vendor && <span className="text-muted-foreground"> · {e.vendor}</span>}
                  {e.notes && <span className="text-muted-foreground"> — {e.notes}</span>}
                </p>
                <p className="text-[12px] text-muted-foreground">{formatDate(e.spent_on + 'T12:00:00Z')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-medium text-foreground">₹{e.amount.toLocaleString('en-IN')}</span>
                <button
                  onClick={() => (confirmingDelete === e.id ? removeExpense(e.id) : setConfirmingDelete(e.id))}
                  onBlur={() => setConfirmingDelete(null)}
                  className="min-h-9 px-2 text-[12px] font-medium text-destructive hover:underline"
                >
                  {confirmingDelete === e.id ? 'Confirm delete?' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
