'use client'

// Shared food-presentation primitives — used by both the customer QR menu
// (components/qr/food-card.tsx) and the POS product grid
// (components/pos/product-card.tsx), so a photo, a veg dot, and a corner badge
// look identical everywhere in the app rather than being redefined per screen.
import { useState } from 'react'
import Image from 'next/image'
import { UtensilsCrossed } from 'lucide-react'

export function VegDot({ isVeg, size = 12 }: { isVeg: boolean | null; size?: number }) {
  if (isVeg === null) return null
  return (
    <span
      aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      className={`grid shrink-0 place-items-center rounded-[3px] border ${
        isVeg ? 'border-success' : 'border-destructive'
      }`}
      style={{ width: size, height: size }}
    >
      <span
        className={`rounded-full ${isVeg ? 'bg-success' : 'bg-destructive'}`}
        style={{ width: size / 2.4, height: size / 2.4 }}
      />
    </span>
  )
}

// Never renders a broken image: a missing photo becomes a calm neutral tile
// (never the old "No photo" block) and a slow one fades in over a skeleton.
export function FoodImage({
  src,
  alt,
  sizes,
  quality = 65,
  priority = false,
  className = '',
}: {
  src: string | null
  alt: string
  sizes: string
  quality?: 65 | 85
  priority?: boolean
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className={`grid h-full w-full place-items-center bg-surface-subtle ${className}`}>
        <UtensilsCrossed size={22} className="text-muted-foreground/40" strokeWidth={1.5} />
      </div>
    )
  }

  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-subtle" />}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
      />
    </>
  )
}

export function FoodBadge({ label, tone }: { label: string; tone: 'gold' | 'green' | 'neutral' }) {
  const cls =
    tone === 'gold' ? 'bg-warning-subtle/95 text-warning'
      : tone === 'green' ? 'bg-primary-subtle/95 text-primary'
      : 'bg-surface/95 text-muted-foreground'
  return (
    <span className={`rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none tracking-wide backdrop-blur-sm ${cls}`}>
      {label}
    </span>
  )
}
