// ── ReputationGauge ────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'

export default function ReputationGauge({
  score,
  reviewCount,
}: {
  score: number | null | undefined
  reviewCount?: number
}) {
  const circleRef = useRef<SVGCircleElement>(null)
  const hasScore = score !== null && score !== undefined
  const s = hasScore ? Math.max(0, Math.min(100, score as number)) : 0

  // Geometry
  const cx = 120, cy = 112, R = 88
  const circumference = 2 * Math.PI * R
  const halfCirc      = circumference / 2
  const trackDash     = `${halfCirc} ${circumference}`
  const activeDash    = `${(s / 100) * halfCirc} ${circumference}`

  // Animate arc on mount / score change
  useEffect(() => {
    const el = circleRef.current
    if (!el || !hasScore) return
    // Start from 0, animate to activeDash
    const target = (s / 100) * halfCirc
    el.style.strokeDasharray = `0 ${circumference}`
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'stroke-dasharray 1s cubic-bezier(0.16,1,0.3,1)'
      el.style.strokeDasharray = `${target} ${circumference}`
    })
    return () => cancelAnimationFrame(raf)
  }, [s, hasScore, halfCirc, circumference])

  // Color thresholds
  const color =
    s >= 80 ? '#059669'
    : s >= 60 ? '#0F766E'
    : s >= 40 ? '#D97706'
    :           '#EF4444'

  const statusLabel =
    s >= 80 ? 'Excellent reputation'
    : s >= 60 ? 'Good reputation'
    : s >= 40 ? 'Needs improvement'
    :           'Critical — take action'

  // Needle — maps 0→180° (left) through 90° (top) to 0° (right)
  const angleDeg = 180 - s * 1.8
  const angleRad = (angleDeg * Math.PI) / 180
  const nLen     = 72
  const nx       = cx + nLen * Math.cos(angleRad)
  const ny       = cy - nLen * Math.sin(angleRad)

  // Arc end label positions (0 at left end, 100 at right end of semicircle)
  // Left end of arc (0%): angle=180° from center, but arc is rotated -180
  // In screen coords, left end is at (cx - R, cy) and right at (cx + R, cy)
  const gradId = 'rgGrad'

  return (
    <div className="flex flex-col items-center w-full">
      <svg
        viewBox="0 0 240 130"
        className="w-full max-w-[280px]"
        aria-label={hasScore ? `Reputation score: ${s} out of 100` : 'No reputation score yet'}
        overflow="visible"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#EF4444" />
            <stop offset="33%"  stopColor="#F59E0B" />
            <stop offset="55%"  stopColor="#EAB308" />
            <stop offset="75%"  stopColor="#34D399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          {/* Clip gradient to the arc shape using the active arc */}
          <clipPath id="rgClip">
            <circle
              cx={cx} cy={cy} r={R}
              fill="none"
              strokeWidth={18}
              strokeDasharray={trackDash}
              transform={`rotate(-180 ${cx} ${cy})`}
              stroke="white"
            />
          </clipPath>
        </defs>

        {/* Track */}
        <circle
          cx={cx} cy={cy} r={R}
          fill="none"
          stroke="rgba(0,0,0,0.04)"
          strokeWidth={18}
          strokeDasharray={trackDash}
          strokeLinecap="butt"
          transform={`rotate(-180 ${cx} ${cy})`}
        />

        {/* Gradient backdrop (full arc, clipped) */}
        <rect
          x={cx - R - 12} y={cy - R - 12}
          width={(R + 12) * 2} height={R + 24}
          fill={`url(#${gradId})`}
          opacity={0.15}
          clipPath="url(#rgClip)"
        />

        {/* Active arc */}
        {hasScore && s > 0 && (
          <circle
            ref={circleRef}
            cx={cx} cy={cy} r={R}
            fill="none"
            stroke={color}
            strokeWidth={18}
            strokeDasharray={activeDash}
            strokeLinecap="butt"
            transform={`rotate(-180 ${cx} ${cy})`}
            opacity={0.9}
          />
        )}

        {/* Scale labels: 0 at left, 100 at right */}
        <text
          x={cx - R - 4} y={cy + 16}
          textAnchor="middle"
          fill="rgba(0,0,0,0.2)"
          fontSize="9"
          fontFamily="inherit"
        >0</text>
        <text
          x={cx + R + 4} y={cy + 16}
          textAnchor="middle"
          fill="rgba(0,0,0,0.2)"
          fontSize="9"
          fontFamily="inherit"
        >100</text>

        {/* Needle */}
        {hasScore && (
          <>
            <line
              x1={cx} y1={cy}
              x2={nx} y2={ny}
              stroke="rgba(0,0,0,0.22)"
              strokeWidth={2}
              strokeLinecap="round"
            />
            {/* Hub */}
            <circle cx={cx} cy={cy} r={7}   fill="white" stroke="rgba(0,0,0,0.08)" strokeWidth={1.5} />
            <circle cx={cx} cy={cy} r={3.5} fill={color} />
          </>
        )}
      </svg>

      {/* Score number below the SVG */}
      <div className="flex flex-col items-center mt-5">
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: '56px',
            fontWeight: 700,
            lineHeight: 1,
            color: hasScore ? color : 'rgba(0,0,0,0.2)',
            letterSpacing: '-2px',
          }}
        >
          {hasScore ? s : '—'}
        </span>
        <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.2)', marginTop: '4px' }}>
          out of 100
        </span>
        {hasScore && (
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color,
              marginTop: '6px',
              letterSpacing: '0.02em',
            }}
          >
            {statusLabel}
          </span>
        )}
        {reviewCount !== undefined && (
          <p className="text-[11px] text-black/25 mt-1">from {reviewCount} reviews</p>
        )}
      </div>
    </div>
  )
}
