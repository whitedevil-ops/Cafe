import { Percent, IndianRupee, Gift, Frown } from 'lucide-react'
import { colorFor, type SpinPrizeKind } from '@/lib/spin-wheel'

export type DialSegment = { label: string; kind: SpinPrizeKind; color: string | null }

const ICON_FOR: Record<SpinPrizeKind, typeof Percent> = {
  percent: Percent,
  flat: IndianRupee,
  item: Gift,
  none: Frown,
}

/** Trims a full slice label ("10% off next visit") down to something that
 *  actually fits inside a wedge ("10% OFF") — the full text still appears
 *  in the result screen and the admin's slice list. */
function shortLabel(label: string, kind: SpinPrizeKind): string {
  if (kind === 'none') return 'Try again'
  const firstPart = label.split(/[-–—,]| next | on /i)[0].trim()
  return firstPart.length <= 14 ? firstPart : `${firstPart.slice(0, 12)}…`
}

/**
 * The wheel face only — no spin logic, no pointer, no center button. Shared
 * between the real customer-facing wheel (components/qr/spin-wheel.tsx) and
 * the admin's live preview (app/dashboard/loyalty/spin-wheel-panel.tsx), so
 * a café never sees a preview that looks different from what a guest gets.
 *
 * Pure SVG rather than a CSS conic-gradient circle: a gradient can only fill
 * color, it cannot place a readable label or icon inside each wedge. Every
 * slice is authored as if it sat at the top (icon and label drawn straight
 * up from center), then rotated into its real position — the label gets one
 * extra 180° flip when that would otherwise land it upside down, the
 * standard fix for radial wheel text.
 */
export function WheelDial({ segments, size = 240 }: { segments: DialSegment[]; size?: number }) {
  const cx = 100
  const cy = 100
  const R = 96
  const n = segments.length

  if (n === 0) {
    return (
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <circle cx={cx} cy={cy} r={R} fill="var(--surface-subtle)" stroke="var(--border-strong)" strokeWidth={2} />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="block">
      <circle cx={cx} cy={cy} r={R + 3} fill="var(--surface)" stroke="var(--border-strong)" strokeWidth={2.5} />
      {segments.map((seg, i) => {
        const start = (i / n) * 360
        const end = ((i + 1) / n) * 360
        const mid = (start + end) / 2
        const large = end - start > 180 ? 1 : 0
        const toXY = (deg: number, r: number) => ({
          x: cx + r * Math.sin((deg * Math.PI) / 180),
          y: cy - r * Math.cos((deg * Math.PI) / 180),
        })
        const p1 = toXY(start, R)
        const p2 = toXY(end, R)
        const fill = colorFor(seg.color, i)
        const flip = mid > 90 && mid < 270
        const Icon = ICON_FOR[seg.kind]
        const label = shortLabel(seg.label, seg.kind)
        const iconY = cy - R * 0.56
        const textY = cy - R * 0.8

        return (
          <g key={i}>
            <path
              d={`M ${cx},${cy} L ${p1.x},${p1.y} A ${R},${R} 0 ${large} 1 ${p2.x},${p2.y} Z`}
              fill={fill}
              stroke="var(--surface)"
              strokeWidth={2}
            />
            <g transform={`rotate(${mid}, ${cx}, ${cy})`}>
              <g transform={`translate(${cx - 8}, ${iconY - 8})`}>
                <Icon size={16} color="white" strokeWidth={2.25} />
              </g>
              <text
                x={cx}
                y={textY}
                transform={flip ? `rotate(180, ${cx}, ${textY})` : undefined}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={600}
                fill="white"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.22)', strokeWidth: 2 }}
              >
                {label}
              </text>
            </g>
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
    </svg>
  )
}
