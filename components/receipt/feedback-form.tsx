'use client'

import { useState } from 'react'
import { Star, Check } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

export function FeedbackForm({ token }: { token: string }) {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (rating === 0) return setError('Tap a star to rate your visit.')
    setSubmitting(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.rpc('submit_feedback', {
      p_token: token,
      p_rating: rating,
      p_comment: comment.trim() || null,
    })
    setSubmitting(false)
    if (err) return setError(err.message)
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-success bg-success-subtle px-4 py-5 text-success">
        <Check size={18} /> <span className="text-[13.5px] font-medium">Thanks for letting us know!</span>
      </div>
    )
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-surface p-5">
      <p className="text-center text-[13.5px] font-medium text-foreground">How was your visit?</p>
      <div className="mt-3 flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="p-1"
          >
            <Star
              size={28}
              className={(hover || rating) >= n ? 'fill-warning text-warning' : 'text-border-strong'}
            />
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything you'd like to add? (optional)"
            rows={2}
            className="mt-3 w-full rounded-[var(--radius)] border border-border-strong bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          {error && <p className="mt-2 text-[12.5px] text-destructive">{error}</p>}
          <button
            onClick={submit}
            disabled={submitting}
            className="mt-3 w-full rounded-[var(--radius)] bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send feedback'}
          </button>
        </>
      )}
      {error && rating === 0 && <p className="mt-2 text-center text-[12.5px] text-destructive">{error}</p>}
    </div>
  )
}
