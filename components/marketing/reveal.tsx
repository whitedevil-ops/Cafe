'use client'

import { motion, useReducedMotion } from 'motion/react'

// One scroll-entrance treatment reused across every marketing section, so
// the page reads as one considered system instead of five different
// animation styles bolted on. Skips the animation entirely (renders in its
// final state, no flash) when the visitor has prefers-reduced-motion set.
export function Reveal({
  children,
  className = '',
  delay = 0,
  y = 16,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  y?: number
}) {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
