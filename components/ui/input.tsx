import { type InputHTMLAttributes, forwardRef } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, className = '', id, ...rest },
  ref,
) {
  const inputId = id || rest.name
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-[13px] font-medium text-foreground">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        className={`h-10 w-full rounded-[var(--radius)] border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors ${
          error ? 'border-destructive' : 'border-border-strong'
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p className="text-[12px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
})
