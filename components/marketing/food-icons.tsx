// Small decorative duotone glyphs for the hero's ambient food motif — a
// restaurant-industry visual cue, not a claim about what any specific café
// sells. Simple flat shapes on purpose: at the small sizes and low opacity
// they're used at, detail would just turn to noise. Single-color via
// currentColor (parent sets `color`), with fill-opacity doing the "duotone"
// shading so no extra color props are needed.

type IconProps = { className?: string }

export function CoffeeCupIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M7 12h15v9a5 5 0 0 1-5 5h-5a5 5 0 0 1-5-5v-9Z" fill="currentColor" fillOpacity="0.16" />
      <path d="M7 12h15v9a5 5 0 0 1-5 5h-5a5 5 0 0 1-5-5v-9Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 14h1.5a3 3 0 0 1 0 6H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 4c0 1.2-1 1.3-1 2.5S12 8.3 12 9.5M17 4c0 1.2-1 1.3-1 2.5S17 8.3 17 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function PizzaSliceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M16 5 27 26a20 20 0 0 1-22 0L16 5Z" fill="currentColor" fillOpacity="0.16" />
      <path d="M16 5 27 26a20 20 0 0 1-22 0L16 5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.5 21.5a19.9 19.9 0 0 0 13 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="14" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="18.5" r="1.4" fill="currentColor" />
      <circle cx="19.5" cy="18.5" r="1.4" fill="currentColor" />
    </svg>
  )
}

export function BurgerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M6 13.5C6 9.4 10.5 6 16 6s10 3.4 10 7.5H6Z" fill="currentColor" fillOpacity="0.16" />
      <path d="M6 13.5C6 9.4 10.5 6 16 6s10 3.4 10 7.5H6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5 17h22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 21h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6.5 25h19a2 2 0 0 0 2-2H4.5a2 2 0 0 0 2 2Z" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function DessertIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M9 14c0-4 3-7 7-7s7 3 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="8" r="1.6" fill="currentColor" />
      <path d="M8 14h16l-1.6 11a3 3 0 0 1-3 2.6H12.6a3 3 0 0 1-3-2.6L8 14Z" fill="currentColor" fillOpacity="0.16" />
      <path d="M8 14h16l-1.6 11a3 3 0 0 1-3 2.6H12.6a3 3 0 0 1-3-2.6L8 14Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.5 18.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ColdDrinkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M10 10h13l-1.6 15.2a2 2 0 0 1-2 1.8h-5.8a2 2 0 0 1-2-1.8L10 10Z" fill="currentColor" fillOpacity="0.16" />
      <path d="M10 10h13l-1.6 15.2a2 2 0 0 1-2 1.8h-5.8a2 2 0 0 1-2-1.8L10 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 10h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 6 15 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.5 14.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1.5 2.5" />
    </svg>
  )
}
