'use client'

import { useEffect, useState } from 'react'

const COLORS = ['#C2410C', '#0F766E', '#7C3AED', '#B45309', '#0369A1', '#BE123C']
const PIECES = 26

type Piece = { left: number; delay: number; duration: number; rotate: number; color: string; drift: number }

/** A brief confetti burst for a real win — no library, no image asset, just
 *  a couple dozen absolutely-positioned pieces falling with a CSS animation,
 *  removed from the DOM once it finishes. Skips entirely under
 *  prefers-reduced-motion (checked by the caller before mounting this). */
export function SpinConfetti({ onDone }: { onDone: () => void }) {
  const [pieces] = useState<Piece[]>(() =>
    Array.from({ length: PIECES }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.25,
      duration: 1.6 + Math.random() * 0.9,
      rotate: Math.round(Math.random() * 360),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      drift: Math.random() * 60 - 30,
    })),
  )

  useEffect(() => {
    const t = setTimeout(onDone, 2600)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block h-2.5 w-1.5 rounded-[1px]"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            // @ts-expect-error -- custom properties read by the keyframes below
            '--drift': `${p.drift}px`,
            '--rotate': `${p.rotate}deg`,
            animation: `spin-confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes spin-confetti-fall {
          0%   { transform: translate(0, -10px) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--drift), 260px) rotate(var(--rotate)); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
