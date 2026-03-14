import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAppStore } from '../store/appStore'

// ── Types ──────────────────────────────────────────────────────────────────

type MatchReason = {
  index:            number
  matchedKeyword:   string
  matchedIndicator: string | null
}

type Problem = {
  rank:                 number
  name:                 string
  keywords:             string[]
  negativeIndicators:   string[]
  mention_count:        number
  trend:                'worsening' | 'improving' | 'stable'
  trend_pct:            number
  severity:             'critical' | 'serious' | 'moderate' | 'minor'
  snippets:             string[]
  review_indices:       number[]
  weekly_volume:        number[]
  mention_timeline:     number[]
  first_seen:           string | null
  low_star_correlation: number
  match_reasons:        MatchReason[]
  specific_action:      string
}

type CompetitorWeakness = {
  problem_name:    string
  comp_mentions:   number
  my_score_pct:    number
  my_positive_pct: number
  opportunity:     boolean
}

type CompetitorAnalysis = {
  id:            string
  name:          string
  google_rating: number | null
  weaknesses:    CompetitorWeakness[]
}

type WeeklyBrief = {
  week_label:   string
  weekly_stats: {
    this_week_count:  number
    last_week_count:  number
    this_week_rating: number | null
    last_week_rating: number | null
  }
  narrative:    string
  top_priority: string
  biggest_win:  string
  action_items: string[]
}

type HealthDeduction = {
  name:     string
  points:   number
  severity: string
  trend:    string
}

type HealthBreakdown = {
  base:                number
  deductions:          HealthDeduction[]
  boosts:              { name: string; points: number }[]
  score_if_fixed_top1: number
  score_if_fixed_top3: number
}

type IntelReport = {
  business_id:         string
  problems:            Problem[]
  competitor_analysis: CompetitorAnalysis[]
  weekly_brief:        WeeklyBrief
  health_score:        number
  health_breakdown:    HealthBreakdown | null
  potential_score:     number
  total_reviews:       number
  week_buckets:        string[]
  crisis_status:       'crisis' | 'warning' | 'healthy'
  unanswered_count:    number
  oldest_unanswered:   string | null
  generated_at:        string
  stale_after:         string | null
  cached?:             boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  const w = Math.floor(d / 7)
  if (w === 1) return '1 week ago'
  return `${w} weeks ago`
}

function weeksAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86_400_000)
  if (d < 7) return `${d} day${d !== 1 ? 's' : ''} ago`
  const w = Math.floor(d / 7)
  return `${w} week${w !== 1 ? 's' : ''} ago`
}

function AnimatedNumber({ target }: { target: number }) {
  const [val, setVal] = useState(0)
  const raf = useRef<number>(0)

  useEffect(() => {
    const start = performance.now()
    const duration = 1000
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(Math.round(eased * target))
      if (t < 1) raf.current = requestAnimationFrame(animate)
    }
    raf.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf.current)
  }, [target])

  return <>{val}</>
}

// ── Loading Skeleton ───────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`bg-[#1e2d4a]/60 rounded-lg animate-pulse ${className ?? ''}`} />
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-56" />
      <Skeleton className="h-40" />
    </div>
  )
}

// ── Trend Badge ────────────────────────────────────────────────────────────

function TrendBadge({ trend, pct }: { trend: string; pct: number }) {
  if (trend === 'worsening') return (
    <span className="flex items-center gap-1 text-xs font-medium text-red-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
      </span>
      ↑ {pct}% worsening
    </span>
  )
  if (trend === 'improving') return (
    <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      ↓ {pct}% improving
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      → stable
    </span>
  )
}

// ── Severity Badge ─────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'critical') return (
    <span className="relative flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
      </span>
      CRITICAL
    </span>
  )
  if (severity === 'serious') return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/40">
      SERIOUS
    </span>
  )
  if (severity === 'moderate') return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40">
      MODERATE
    </span>
  )
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 border border-gray-600/40">
      MINOR
    </span>
  )
}

// ── Section 1: Crisis / Health Alert Banner ────────────────────────────────

function CrisisAlertBanner({ report }: { report: IntelReport }) {
  const { crisis_status, problems, generated_at } = report
  const criticalCount = (problems ?? []).filter(p => p.severity === 'critical').length
  const seriousCount  = (problems ?? []).filter(p => p.severity === 'serious').length
  const warningCount  = criticalCount + seriousCount

  if (crisis_status === 'crisis') {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-900/25 to-[#0a1020] p-5 flex items-center justify-between gap-4">
        <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent pointer-events-none" />
        <div className="flex items-center gap-4 relative z-10">
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-2xl">🔴</div>
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 animate-ping" />
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500" />
          </div>
          <div>
            <p className="text-lg font-black text-red-300 tracking-tight">CRISIS DETECTED — Immediate Action Required</p>
            <p className="text-sm text-gray-300 mt-0.5">
              {criticalCount} critical issue{criticalCount !== 1 ? 's are' : ' is'} actively damaging your reputation
            </p>
            <p className="text-xs text-red-400/80 mt-0.5">Your rating is at risk if left unaddressed</p>
          </div>
        </div>
        <p className="text-xs text-gray-600 relative z-10 shrink-0">Updated {relativeTime(generated_at)}</p>
      </div>
    )
  }

  if (crisis_status === 'warning') {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-900/15 to-[#0a1020] p-5 flex items-center justify-between gap-4">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-transparent pointer-events-none" />
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-2xl shrink-0">🟡</div>
          <div>
            <p className="text-lg font-black text-amber-300 tracking-tight">WARNING — {warningCount} issue{warningCount !== 1 ? 's' : ''} need attention this week</p>
            <p className="text-sm text-gray-400 mt-0.5">Monitor closely and address before they escalate</p>
          </div>
        </div>
        <p className="text-xs text-gray-600 relative z-10 shrink-0">Updated {relativeTime(generated_at)}</p>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-900/15 to-[#0a1020] p-5 flex items-center justify-between gap-4">
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent pointer-events-none" />
      <div className="flex items-center gap-4 relative z-10">
        <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-2xl shrink-0">🟢</div>
        <div>
          <p className="text-lg font-black text-emerald-300 tracking-tight">HEALTHY — No significant issues detected</p>
          <p className="text-sm text-gray-400 mt-0.5">Your reputation is stable and improving</p>
        </div>
      </div>
      <p className="text-xs text-gray-600 relative z-10 shrink-0">Updated {relativeTime(generated_at)}</p>
    </div>
  )
}

// ── Section 2: Problem Cards ───────────────────────────────────────────────

const RANK_STYLES = [
  { border: 'border-l-red-500',    bg: 'bg-red-500/5',    rankColor: 'text-red-500/15',    dot: 'bg-red-500',    bar: 'bg-red-500'    },
  { border: 'border-l-orange-500', bg: 'bg-orange-500/5', rankColor: 'text-orange-500/15', dot: 'bg-orange-500', bar: 'bg-orange-500' },
  { border: 'border-l-yellow-500', bg: 'bg-yellow-500/5', rankColor: 'text-yellow-500/15', dot: 'bg-yellow-500', bar: 'bg-yellow-500' },
  { border: 'border-l-gray-500',   bg: 'bg-gray-500/5',   rankColor: 'text-gray-500/15',   dot: 'bg-gray-500',   bar: 'bg-gray-600'   },
  { border: 'border-l-gray-600',   bg: 'bg-gray-600/5',   rankColor: 'text-gray-600/15',   dot: 'bg-gray-600',   bar: 'bg-gray-700'   },
]

function ProblemCard({ problem, maxCount, totalReviews, index, onViewReviews }: {
  problem:       Problem
  maxCount:      number
  totalReviews:  number
  index:         number
  onViewReviews: (indices: number[], matchReasons: MatchReason[]) => void
}) {
  const style    = RANK_STYLES[Math.min(index, RANK_STYLES.length - 1)]
  const barWidth = maxCount > 0 ? Math.round((problem.mention_count / maxCount) * 100) : 0
  const pct      = totalReviews > 0 ? Math.round((problem.mention_count / totalReviews) * 100) : 0

  // Velocity line: last 3 non-zero buckets of mention_timeline
  const timeline = Array.isArray(problem.mention_timeline) ? problem.mention_timeline : (Array.isArray(problem.weekly_volume) ? problem.weekly_volume : [])
  const lastThree = timeline.slice(-3)
  const isAccelerating = lastThree.length >= 2 && lastThree[lastThree.length - 1] > lastThree[0]

  return (
    <div
      className={`relative rounded-xl border border-[#1e2d4a] border-l-4 ${style.border} ${style.bg} p-5 flex flex-col gap-4 transition-all duration-300 hover:border-[#2d3f5e] hover:-translate-y-0.5`}
    >
      {/* Ghost rank number */}
      <span className={`text-8xl font-black leading-none select-none ${style.rankColor} absolute top-3 right-4 pointer-events-none`}>
        #{problem.rank}
      </span>

      {/* Header row */}
      <div className="relative z-10 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={problem.severity} />
          <TrendBadge trend={problem.trend} pct={problem.trend_pct} />
        </div>
        <h3 className="text-base font-bold text-gray-100 leading-snug">{problem.name}</h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black text-gray-200">{problem.mention_count}</span>
          <span className="text-xs text-gray-500">mentions · {pct}% of reviews</span>
        </div>
      </div>

      {/* First seen */}
      {problem.first_seen && (
        <p className="text-[11px] text-gray-500">
          First appeared {weeksAgo(problem.first_seen)}
        </p>
      )}

      {/* Volume bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Complaint Volume</span>
        </div>
        <div className="h-2 bg-[#1e2d4a] rounded-full overflow-hidden">
          <div
            className={`h-full ${style.bar} rounded-full transition-all duration-700`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {/* Velocity */}
      {isAccelerating && lastThree.some(v => v > 0) && (
        <p className="text-[11px] text-red-400/80">
          Accelerating — {lastThree.map((v, i) => `${v}`).join(' → ')} mentions (last 3 weeks)
        </p>
      )}

      {/* Verbatim quotes */}
      {(problem.snippets ?? []).length > 0 && (
        <div className="space-y-1.5">
          {(problem.snippets ?? []).slice(0, 2).map((s, i) => (
            <blockquote key={i} className="text-xs text-gray-400 italic border-l-2 border-[#1e2d4a] pl-3 leading-relaxed">
              "{s}…"
            </blockquote>
          ))}
        </div>
      )}

      {/* Business impact */}
      {problem.low_star_correlation > 0 && (
        <p className="text-[11px] text-amber-400/80">
          Correlates with {problem.low_star_correlation} of your lowest-rated reviews
        </p>
      )}

      {/* Specific action */}
      {problem.specific_action && (
        <div className="bg-[#080d1a] border border-purple-500/15 rounded-lg p-3">
          <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1">Recommended Action</p>
          <p className="text-xs text-gray-300 leading-relaxed">{problem.specific_action}</p>
        </div>
      )}

      {/* CTA */}
      {(problem.review_indices ?? []).length > 0 && (
        <button
          onClick={() => onViewReviews(problem.review_indices ?? [], problem.match_reasons ?? [])}
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors self-start flex items-center gap-1 mt-auto"
        >
          View {problem.review_indices.length} related reviews →
        </button>
      )}
    </div>
  )
}

// ── Section 3: "When Did This Start?" Timeline ─────────────────────────────

function TimelineSection({ problems, weekBuckets }: { problems: Problem[]; weekBuckets: string[] }) {
  const top3 = (problems ?? []).slice(0, 3).filter(p => {
    const tl = Array.isArray(p.mention_timeline) ? p.mention_timeline : []
    return tl.some(v => v > 0)
  })

  if (top3.length === 0) return null

  const severityColor = (s: string) =>
    s === 'critical' ? 'text-red-400' : s === 'serious' ? 'text-orange-400' : s === 'moderate' ? 'text-amber-400' : 'text-gray-400'

  return (
    <div className="card p-5 space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-100">When Did This Start?</h2>
        <p className="text-xs text-gray-500 mt-0.5">Weekly complaint volume over the last 8 weeks</p>
      </div>
      <div className="space-y-5">
        {top3.map(problem => {
          const timeline = Array.isArray(problem.mention_timeline) ? problem.mention_timeline : (Array.isArray(problem.weekly_volume) ? problem.weekly_volume : [])
          const maxVal = Math.max(1, ...timeline)

          return (
            <div key={problem.name} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${severityColor(problem.severity)}`}>{problem.name}</span>
                <TrendBadge trend={problem.trend} pct={problem.trend_pct} />
              </div>
              <div className="flex items-end gap-1">
                {timeline.map((count, i) => {
                  const height = maxVal > 0 ? Math.max(2, Math.round((count / maxVal) * 40)) : 2
                  const isLast = i === timeline.length - 1
                  const barColor = problem.severity === 'critical' ? 'bg-red-500' :
                    problem.severity === 'serious' ? 'bg-orange-500' :
                    problem.severity === 'moderate' ? 'bg-amber-500' : 'bg-gray-500'
                  return (
                    <div key={i} className="flex flex-col items-center gap-1 flex-1">
                      <span className={`text-[9px] ${count > 0 ? 'text-gray-400' : 'text-gray-700'}`}>{count > 0 ? count : ''}</span>
                      <div
                        className={`w-full rounded-t-sm transition-all ${barColor} ${isLast ? 'opacity-100' : 'opacity-60'}`}
                        style={{ height: `${height}px` }}
                      />
                      <span className="text-[8px] text-gray-600 truncate w-full text-center">{weekBuckets[i] ?? `W${i+1}`}</span>
                    </div>
                  )
                })}
                <div className="flex flex-col items-center gap-1 shrink-0 ml-1">
                  <span className="text-[9px] text-purple-400 font-bold">← now</span>
                  <div className="w-px h-[40px] bg-purple-500/30" />
                  <span className="text-[8px] text-purple-500/50">here</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Section 4: Trend Chart (SVG) ───────────────────────────────────────────

function TrendChart({ problems, weekBuckets }: { problems: Problem[]; weekBuckets: string[] }) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string
    values: { name: string; count: number; color: string }[]
  } | null>(null)

  const colors = ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#06b6d4']
  const top3   = (problems ?? []).slice(0, 3)

  const maxVal = Math.max(1, ...top3.flatMap(p => {
    const vol = Array.isArray(p.weekly_volume) ? p.weekly_volume : []
    return vol
  }))
  const chartH = 120
  const chartW = 500
  const padL   = 24
  const padR   = 8
  const padT   = 8
  const padB   = 20
  const innerW = chartW - padL - padR
  const innerH = chartH - padT - padB

  const xScale = (i: number) => padL + (weekBuckets.length > 1 ? (i / (weekBuckets.length - 1)) : 0) * innerW
  const yScale = (v: number) => padT + innerH - (v / maxVal) * innerH

  if (top3.length === 0) return null

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-bold text-gray-100">Are Your Problems Getting Better or Worse?</h2>
        <p className="text-xs text-gray-500 mt-0.5">Complaint volume over the last 8 weeks</p>
      </div>
      <div className="flex flex-wrap gap-4">
        {top3.map((p, i) => (
          <div key={p.name} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: colors[i] }} />
            <span className="text-xs text-gray-400">{p.name}</span>
          </div>
        ))}
      </div>
      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full"
          style={{ minWidth: '280px' }}
          onMouseLeave={() => setTooltip(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <line key={t} x1={padL} y1={padT + innerH * (1 - t)} x2={chartW - padR} y2={padT + innerH * (1 - t)} stroke="#1e2d4a" strokeWidth={1} />
          ))}
          {weekBuckets.map((label, i) => (
            <text key={i} x={xScale(i)} y={chartH - 4} textAnchor="middle" fontSize={8} fill="#4b5563">{label}</text>
          ))}
          {top3.map((p, pi) => {
            const vol = Array.isArray(p.weekly_volume) ? p.weekly_volume : []
            const pts = vol.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ')
            return (
              <polyline key={p.name} points={pts} fill="none" stroke={colors[pi]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )
          })}
          {weekBuckets.map((label, i) => (
            <rect
              key={i}
              x={xScale(i) - 12} y={padT} width={24} height={innerH}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => {
                setTooltip({
                  x: xScale(i),
                  y: Math.min(...top3.map(p => {
                    const vol = Array.isArray(p.weekly_volume) ? p.weekly_volume : []
                    return yScale(vol[i] ?? 0)
                  })),
                  label,
                  values: top3.map((p, pi) => {
                    const vol = Array.isArray(p.weekly_volume) ? p.weekly_volume : []
                    return { name: p.name, count: vol[i] ?? 0, color: colors[pi] }
                  }),
                })
              }}
            />
          ))}
          {tooltip && (
            <g>
              <line x1={tooltip.x} y1={padT} x2={tooltip.x} y2={padT + innerH} stroke="#374151" strokeWidth={1} strokeDasharray="3,2" />
              {top3.map((p, pi) => {
                const vol = Array.isArray(p.weekly_volume) ? p.weekly_volume : []
                const v = vol[weekBuckets.indexOf(tooltip.label)] ?? 0
                return <circle key={pi} cx={tooltip.x} cy={yScale(v)} r={3} fill={colors[pi]} />
              })}
            </g>
          )}
        </svg>
        {tooltip && (
          <div
            className="absolute top-0 pointer-events-none bg-[#0a1020] border border-[#1e2d4a] rounded-lg p-2 text-xs shadow-lg"
            style={{ left: `clamp(0px, ${(tooltip.x / chartW) * 100}%, calc(100% - 140px))`, transform: 'translateY(10px)' }}
          >
            <p className="text-gray-400 mb-1.5 font-medium">{tooltip.label}</p>
            {tooltip.values.map(v => (
              <div key={v.name} className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                <span className="text-gray-300">{v.count}</span>
                <span className="text-gray-500 truncate max-w-[80px]">{v.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section 5: Competitive Intelligence ───────────────────────────────────

function CompetitorSection({ competitors, problems }: { competitors: CompetitorAnalysis[]; problems: Problem[] }) {
  if (!competitors || competitors.length === 0) {
    return (
      <div className="card p-8 text-center space-y-2">
        <p className="text-2xl">🔍</p>
        <p className="text-sm font-medium text-gray-300">No competitor data yet</p>
        <p className="text-xs text-gray-500">Add competitors in Competitor Spy to unlock this section</p>
      </div>
    )
  }

  return (
    <div className="card p-5 space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-100">Competitive Intelligence</h2>
        <p className="text-xs text-gray-500 mt-0.5">Where you win and where competitors struggle</p>
      </div>
      <div className="space-y-6">
        {competitors.map(comp => (
          <div key={comp.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
                {comp.name[0]?.toUpperCase()}
              </div>
              <div>
                <span className="text-sm font-semibold text-gray-200">{comp.name}</span>
                {comp.google_rating != null && (
                  <span className="ml-1.5 text-xs text-yellow-400">⭐ {comp.google_rating}</span>
                )}
              </div>
            </div>
            <div className="pl-9 space-y-3">
              {(comp.weaknesses ?? []).map(w => {
                const relatedProblem = problems.find(p => p.name === w.problem_name)
                return (
                  <div key={w.problem_name} className="bg-[#080d1a] border border-[#1a2540] rounded-xl p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-xs text-gray-300">
                          <span className="font-semibold text-orange-400">{w.comp_mentions}</span> {w.problem_name} complaints
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Your score on this topic: <span className={`font-semibold ${w.my_score_pct >= 75 ? 'text-emerald-400' : w.my_score_pct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{w.my_score_pct}%</span>
                        </p>
                      </div>
                      {w.opportunity && (
                        <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 whitespace-nowrap">
                          ✓ You win here
                        </span>
                      )}
                    </div>
                    {w.opportunity && (
                      <p className="text-[11px] text-emerald-400/80">
                        OPPORTUNITY: You are winning on {w.problem_name} — {w.comp_mentions} competitor complaints vs your {w.my_score_pct}% satisfaction rate
                      </p>
                    )}
                    {relatedProblem?.specific_action && w.opportunity && (
                      <p className="text-[11px] text-purple-400/80">
                        Suggested: {relatedProblem.specific_action}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section 6: Weekly Intelligence Brief ──────────────────────────────────

function ActionItem({ text }: { text: string }) {
  const [checked, setChecked] = useState(false)
  return (
    <button
      onClick={() => setChecked(c => !c)}
      className={`w-full flex items-start gap-3 text-left py-2 px-3 rounded-lg transition-all ${checked ? 'opacity-50' : 'hover:bg-white/3'}`}
    >
      <span className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
        checked ? 'bg-purple-500/30 border-purple-500/50 text-purple-300' : 'border-[#2d3f5e]'
      }`}>
        {checked && (
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className={`text-xs leading-relaxed ${checked ? 'line-through text-gray-600' : 'text-gray-300'}`}>{text}</span>
    </button>
  )
}

function StatRow({ label, current, previous, delta, positiveIsUp, decimals = 0 }: {
  label:       string
  current:     number
  previous:    number
  delta:       number
  positiveIsUp: boolean
  decimals?:   number
}) {
  const isPositive = positiveIsUp ? delta >= 0 : delta <= 0
  const color      = delta === 0 ? 'text-gray-500' : isPositive ? 'text-emerald-400' : 'text-red-400'
  const arrow      = delta === 0 ? '→' : delta > 0 ? '↑' : '↓'

  return (
    <div className="flex items-center justify-between py-2 border-b border-[#1a2540]">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-600">{previous.toFixed(decimals)}</span>
        <span className="text-gray-700">→</span>
        <span className="text-sm font-bold text-gray-200">{current.toFixed(decimals)}</span>
        <span className={`text-xs font-semibold ${color}`}>{arrow} {Math.abs(delta).toFixed(decimals)}</span>
      </div>
    </div>
  )
}

function WeeklyBriefSection({ brief }: { brief: WeeklyBrief }) {
  const stats       = brief.weekly_stats
  const reviewDelta = stats.this_week_count - stats.last_week_count
  const ratingDelta = stats.this_week_rating && stats.last_week_rating
    ? Math.round((stats.this_week_rating - stats.last_week_rating) * 10) / 10
    : null

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e2d4a] bg-gradient-to-r from-purple-900/20 to-transparent flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Intelligence Brief</p>
          <h2 className="text-sm font-bold text-gray-200 mt-0.5">{brief.week_label}</h2>
        </div>
        <span className="text-xl">📰</span>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">This Week vs Last Week</h3>
          <div className="space-y-3">
            <StatRow
              label="New Reviews"
              current={stats.this_week_count}
              previous={stats.last_week_count}
              delta={reviewDelta}
              positiveIsUp
            />
            {ratingDelta !== null && (
              <StatRow
                label="Avg Rating"
                current={stats.this_week_rating ?? 0}
                previous={stats.last_week_rating ?? 0}
                delta={ratingDelta}
                positiveIsUp
                decimals={1}
              />
            )}
          </div>
        </div>
        <div className="space-y-3">
          <div className="bg-[#080d1a] rounded-lg p-3 border border-[#1e2d4a]">
            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">🎯 Your #1 Priority This Week</p>
            <p className="text-xs text-gray-200 leading-relaxed">{brief.top_priority || 'Keep engaging with customer reviews.'}</p>
          </div>
          <div className="bg-[#080d1a] rounded-lg p-3 border border-[#1e2d4a]">
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">🏆 Biggest Win This Week</p>
            <p className="text-xs text-gray-200 leading-relaxed">{brief.biggest_win || 'Continue delivering great service.'}</p>
          </div>
        </div>
      </div>

      {/* Narrative paragraph */}
      {brief.narrative && (
        <div className="px-5 pb-4">
          <div className="bg-[#080d1a] rounded-xl p-4 border border-purple-500/10">
            <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">AI Consultant Summary</p>
            <p className="text-xs text-gray-300 leading-relaxed">{brief.narrative}</p>
          </div>
        </div>
      )}

      {/* Action items checklist */}
      {Array.isArray(brief.action_items) && brief.action_items.length > 0 && (
        <div className="px-5 pb-5">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Action Items</p>
          <div className="space-y-2">
            {brief.action_items.map((item, i) => (
              <ActionItem key={i} text={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Section 7: Unanswered Review Tracker ──────────────────────────────────

function UnansweredTracker({ unansweredCount, oldestUnanswered, onNavigateResponder }: {
  unansweredCount:    number
  oldestUnanswered:   string | null
  onNavigateResponder: () => void
}) {
  if (unansweredCount === 0) return null

  return (
    <div className="card p-5 border border-amber-500/20">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">⚠️</span>
        <div className="space-y-2 flex-1">
          <h3 className="text-sm font-bold text-amber-300">
            {unansweredCount} negative review{unansweredCount !== 1 ? 's' : ''} have never been responded to
          </h3>
          {oldestUnanswered && (
            <p className="text-xs text-gray-400">
              Oldest unanswered: {relativeTime(oldestUnanswered)}
            </p>
          )}
          <p className="text-xs text-gray-400">
            Average response rate: <span className="text-red-400 font-semibold">0%</span>{' '}
            <span className="text-gray-500">(industry average: 67%)</span>
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Businesses that respond to reviews average 0.4 stars higher than those that don't
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={onNavigateResponder}
              className="btn-primary text-xs px-4 py-2"
            >
              Generate Responses
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section 8: Business Health Score ──────────────────────────────────────

function HealthScoreSection({ score, breakdown, problems }: {
  score:     number
  breakdown: HealthBreakdown | null
  problems:  Problem[]
}) {
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
  const label = score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 50 ? 'Fair' : 'Needs Work'

  const safeProblems = Array.isArray(problems) ? problems : []
  const top1Name     = safeProblems[0]?.name ?? ''
  const potTop1      = breakdown?.score_if_fixed_top1 ?? Math.min(100, score + 23)
  const potTop3      = breakdown?.score_if_fixed_top3 ?? Math.min(100, score + 50)

  return (
    <div className="card p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-100">Business Health Score</h2>
          <p className="text-xs text-gray-500 mt-0.5">Calculated from your review sentiment and complaint patterns</p>
        </div>
        <div className="flex items-end gap-3 shrink-0">
          <span className="text-5xl font-black" style={{ color }}>
            <AnimatedNumber target={score} />
          </span>
          <span className="text-xl text-gray-600 pb-1">/100</span>
          <span className="text-sm font-bold pb-1" style={{ color }}>{label}</span>
        </div>
      </div>

      {/* Score bar */}
      <div className="space-y-2">
        <div className="h-3 bg-[#1e2d4a] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${score}%`, backgroundColor: color }} />
        </div>
        {potTop3 > score && (
          <div className="relative h-2 bg-[#1e2d4a] rounded-full overflow-hidden">
            <div className="h-full rounded-full opacity-30 transition-all duration-1000" style={{ width: `${potTop3}%`, backgroundColor: '#a855f7' }} />
            <div className="absolute top-0 h-full rounded-full opacity-60" style={{ left: `${score}%`, width: `${potTop3 - score}%`, backgroundColor: '#a855f7' }} />
          </div>
        )}
      </div>

      {/* Breakdown */}
      {breakdown && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Deductions */}
          {breakdown.deductions.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider">↓ What's Dragging You Down</p>
              {breakdown.deductions.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  <span className="flex-1 truncate">{d.name}</span>
                  <span className="text-red-400 font-semibold shrink-0">{d.points}pts</span>
                  <span className="text-gray-600 text-[10px] shrink-0">{d.trend}</span>
                </div>
              ))}
            </div>
          )}

          {/* Boosts or potential */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">↑ What's Keeping You Afloat</p>
            {breakdown.boosts.length > 0 ? (
              breakdown.boosts.map(b => (
                <div key={b.name} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  {b.name}
                  <span className="text-emerald-500 ml-auto">+{b.points}pts</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-600">Your positive reviews are maintaining the baseline</p>
            )}
          </div>
        </div>
      )}

      {/* Projections */}
      <div className="bg-[#080d1a] border border-purple-500/15 rounded-xl p-4 space-y-2">
        <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-3">Score Improvement Potential</p>
        {top1Name && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">If you fix <span className="text-gray-200 font-medium">{top1Name}</span> alone:</span>
            <span className="font-bold text-purple-300">score → {potTop1}/100</span>
          </div>
        )}
        {safeProblems.length >= 3 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">If you fix all top 3 issues:</span>
            <span className="font-bold text-purple-300">score → {potTop3}/100</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Review Modal ────────────────────────────────────────────────────────────

type ReviewRow = {
  review_text:   string
  reviewer_name: string
  rating:        number | null
  sentiment:     string | null
  reviewed_at:   string | null
}

function ReviewModal({ indices, matchReasons, onClose }: {
  indices:      number[]
  matchReasons: MatchReason[]
  onClose:      () => void
}) {
  const { activeBusiness } = useAppStore()
  const [allReviews, setAllReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeBusiness || indices.length === 0) { setLoading(false); return }
    supabase
      .from('reviews')
      .select('review_text, reviewer_name, rating, sentiment, reviewed_at')
      .eq('business_id', activeBusiness.id)
      .then(({ data }) => {
        if (data) {
          const matched: ReviewRow[] = indices.map(i => data[i]).filter(Boolean)
          // Sort: lowest rating first, then most recent, then longest text
          matched.sort((a, b) => {
            const ratingA = a.rating ?? 5
            const ratingB = b.rating ?? 5
            if (ratingA !== ratingB) return ratingA - ratingB
            const dateA = a.reviewed_at ? new Date(a.reviewed_at).getTime() : 0
            const dateB = b.reviewed_at ? new Date(b.reviewed_at).getTime() : 0
            if (dateA !== dateB) return dateB - dateA
            return (b.review_text?.length ?? 0) - (a.review_text?.length ?? 0)
          })
          setAllReviews(matched)
        }
        setLoading(false)
      })
  }, [])

  const reasonByIndex = new Map<number, MatchReason>(matchReasons.map(r => [r.index, r]))

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2d4a]">
          <p className="text-sm font-semibold text-gray-200">Related Reviews ({indices.length})</p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {loading && <div className="text-center text-xs text-gray-500 py-6">Loading reviews…</div>}
          {allReviews.map((r, i) => {
            const originalIndex = indices[i]
            const reason = reasonByIndex.get(originalIndex)
            return (
              <div key={i} className="bg-[#080d1a] border border-[#1e2d4a] rounded-xl p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-gray-300">{r.reviewer_name || 'Anonymous'}</span>
                  {r.rating != null && (
                    <span className="text-xs text-yellow-400">{'⭐'.repeat(Math.min(r.rating, 5))}</span>
                  )}
                  {r.sentiment && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      r.sentiment === 'positive' ? 'bg-emerald-500/15 text-emerald-400' :
                      r.sentiment === 'negative' ? 'bg-red-500/15 text-red-400' :
                      'bg-gray-500/15 text-gray-400'
                    }`}>{r.sentiment}</span>
                  )}
                  {r.reviewed_at && (
                    <span className="text-[10px] text-gray-600">{relativeTime(r.reviewed_at)}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{r.review_text}</p>
                {reason && (
                  <div className="text-[10px] text-purple-400/70 mt-1">
                    Matched: "{reason.matchedKeyword}"{reason.matchedIndicator ? ` + "${reason.matchedIndicator}"` : ''} in negative review
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Page Header ────────────────────────────────────────────────────────────

function Header({ onRefresh, generating, report }: {
  onRefresh:  () => void
  generating: boolean
  report:     IntelReport | null
}) {
  const isStale = report?.stale_after ? new Date(report.stale_after) < new Date() : false

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-100">Intelligence</h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {report?.cached && <span className="text-xs text-emerald-500">From cache</span>}
          {report?.generated_at && (
            <p className="text-xs text-gray-500">
              {report.cached ? '· ' : ''}Last generated {relativeTime(report.generated_at)} · Cached 7 days
            </p>
          )}
          {isStale && report?.generated_at && (
            <span className="text-xs text-amber-500/70 italic">
              Data may be stale — generated {relativeTime(report.generated_at)}
            </span>
          )}
          {!report && <p className="text-xs text-gray-500">Premium intelligence briefing for your business</p>}
        </div>
      </div>
      <button
        onClick={onRefresh}
        disabled={generating}
        className="btn-primary w-full sm:w-auto px-4 py-2 min-h-[44px] text-xs flex items-center justify-center gap-1.5"
      >
        {generating ? (
          <>
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Analyzing…
          </>
        ) : '🎯 Refresh Intelligence'}
      </button>
    </div>
  )
}

// ── Normalizer ─────────────────────────────────────────────────────────────

function normalizeReport(raw: Record<string, unknown>): IntelReport {
  const rawBrief = (raw.weekly_brief ?? {}) as Record<string, unknown>
  return {
    business_id:         (raw.business_id as string) ?? '',
    problems:            Array.isArray(raw.problems)            ? raw.problems as Problem[]            : [],
    competitor_analysis: Array.isArray(raw.competitor_analysis) ? raw.competitor_analysis as CompetitorAnalysis[] : [],
    week_buckets:        Array.isArray(raw.week_buckets)        ? raw.week_buckets as string[]         : [],
    health_score:        (raw.health_score as number)           ?? 0,
    health_breakdown:    (raw.health_breakdown as HealthBreakdown | null) ?? null,
    potential_score:     (raw.potential_score as number)        ?? (raw.health_score as number) ?? 0,
    total_reviews:       (raw.total_reviews as number)          ?? 0,
    crisis_status:       ((raw.crisis_status as string) ?? 'healthy') as IntelReport['crisis_status'],
    unanswered_count:    (raw.unanswered_count as number)       ?? 0,
    oldest_unanswered:   (raw.oldest_unanswered as string | null) ?? null,
    generated_at:        (raw.generated_at as string)           ?? new Date().toISOString(),
    stale_after:         (raw.stale_after as string | null)     ?? null,
    cached:              (raw.cached as boolean)                ?? false,
    weekly_brief: {
      week_label:   (rawBrief.week_label as string)   ?? '',
      narrative:    (rawBrief.narrative as string)    ?? '',
      top_priority: (rawBrief.top_priority as string) ?? '',
      biggest_win:  (rawBrief.biggest_win as string)  ?? '',
      action_items: Array.isArray(rawBrief.action_items) ? rawBrief.action_items as string[] : [],
      weekly_stats: rawBrief.weekly_stats ? (rawBrief.weekly_stats as WeeklyBrief['weekly_stats']) : {
        this_week_count: 0, last_week_count: 0, this_week_rating: null, last_week_rating: null,
      },
    },
  }
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function Intelligence() {
  const { user }                      = useAuth()
  const { activeBusiness, setPendingNavPage } = useAppStore()

  const [report, setReport]       = useState<IntelReport | null>(null)
  const [loading, setLoading]     = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError]         = useState('')
  const [reviewModal, setReviewModal] = useState<{ indices: number[]; matchReasons: MatchReason[] } | null>(null)

  useEffect(() => {
    if (!user || !activeBusiness) return
    loadReport(false)
  }, [user?.id, activeBusiness?.id])

  const loadReport = async (forceRefresh: boolean) => {
    if (!activeBusiness) return
    forceRefresh ? setGenerating(true) : setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/generate-intelligence', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          business_id:   activeBusiness.id,
          business_name: activeBusiness.name,
          business_type: activeBusiness.type,
          force_refresh: forceRefresh,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        if (body.error === 'insufficient_reviews') {
          setError(`insufficient_reviews:${body.count ?? 0}`)
          return
        }
        throw new Error(body.error ?? `API error ${res.status}`)
      }

      const raw = await res.json()
      setReport(normalizeReport(raw))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate intelligence report')
    } finally {
      setLoading(false)
      setGenerating(false)
    }
  }

  // ── No business ──
  if (!activeBusiness) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-2xl">🎯</p>
        <p className="text-sm text-gray-400">Select a business to view intelligence</p>
      </div>
    )
  }

  // ── Loading ──
  if (loading) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Intelligence</h1>
          <p className="text-xs text-gray-500 mt-0.5">Building your intelligence report…</p>
        </div>
      </div>
      <LoadingSkeleton />
    </div>
  )

  // ── Insufficient reviews ──
  if (error.startsWith('insufficient_reviews')) {
    const count = parseInt(error.split(':')[1] ?? '0')
    return (
      <div className="space-y-6">
        <Header onRefresh={() => loadReport(true)} generating={generating} report={report} />
        <div className="card p-10 text-center space-y-3">
          <p className="text-4xl">📋</p>
          <p className="text-base font-semibold text-gray-200">Not enough reviews yet</p>
          <p className="text-sm text-gray-400">
            You have <span className="text-white font-bold">{count}</span> review{count !== 1 ? 's' : ''}.
            Intelligence requires at least <span className="text-white font-bold">20</span> reviews for accurate problem detection.
          </p>
          <p className="text-xs text-gray-600">Fetch more reviews from the Dashboard to unlock this feature.</p>
        </div>
      </div>
    )
  }

  // ── Error ──
  if (error && !report) {
    return (
      <div className="space-y-6">
        <Header onRefresh={() => loadReport(true)} generating={generating} report={report} />
        <div className="card p-6 flex items-center gap-3 text-red-400 text-sm">
          <span>⚠</span>
          <span>{error}</span>
          <button onClick={() => loadReport(false)} className="ml-auto underline text-xs hover:no-underline">Retry</button>
        </div>
      </div>
    )
  }

  // ── No report yet ──
  if (!report) {
    return (
      <div className="space-y-6">
        <Header onRefresh={() => loadReport(true)} generating={generating} report={null} />
        <div className="card p-10 text-center space-y-4">
          <p className="text-5xl">🎯</p>
          <p className="text-base font-semibold text-gray-200">Your Intelligence Briefing Awaits</p>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            Detect your top problems, track trends, analyze competitors, and get your weekly brief — all in one place.
          </p>
          <p className="text-xs text-gray-500 max-w-sm mx-auto italic">
            Uses Claude Sonnet for deeper analysis than standard AI Insights.
          </p>
          <button
            onClick={() => loadReport(true)}
            disabled={generating}
            className="btn-primary px-6 py-3 text-sm mx-auto flex items-center gap-2"
          >
            {generating ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analyzing reviews…
              </>
            ) : '🎯 Generate Intelligence Report'}
          </button>
        </div>
      </div>
    )
  }

  const maxCount = Math.max(1, ...report.problems.map(p => p.mention_count))

  return (
    <div className="space-y-6 pb-4">
      <Header onRefresh={() => loadReport(true)} generating={generating} report={report} />

      {/* Differentiation banner */}
      <div className="text-xs text-gray-600 italic border-b border-[#1e2d4a] pb-3 mb-1">
        AI Insights shows what customers say. Intelligence shows what it means for your business and what to do about it.
      </div>

      {/* S1: Crisis / Health Alert Banner */}
      <CrisisAlertBanner report={report} />

      {/* S2: Problem Cards */}
      {report.problems.length > 0 ? (
        <>
          <div>
            <h2 className="text-base font-bold text-gray-100 mb-1">Top Problems Detected</h2>
            <p className="text-xs text-gray-500">
              Detected from {report.total_reviews} reviews — only reviews that are both topically relevant AND negative are counted
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {report.problems.slice(0, 3).map((p, i) => (
              <ProblemCard
                key={p.name}
                problem={p}
                maxCount={maxCount}
                totalReviews={report.total_reviews}
                index={i}
                onViewReviews={(indices, matchReasons) => setReviewModal({ indices, matchReasons })}
              />
            ))}
          </div>
          {report.problems.length > 3 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {report.problems.slice(3).map((p, i) => (
                <ProblemCard
                  key={p.name}
                  problem={p}
                  maxCount={maxCount}
                  totalReviews={report.total_reviews}
                  index={i + 3}
                  onViewReviews={(indices, matchReasons) => setReviewModal({ indices, matchReasons })}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="card p-8 text-center space-y-2">
          <p className="text-2xl">✅</p>
          <p className="text-sm text-gray-300">No recurring problems detected</p>
          <p className="text-xs text-gray-500">Your customers are happy across all areas.</p>
        </div>
      )}

      {/* S3: When Did This Start? Timeline */}
      {report.problems.length > 0 && (
        <TimelineSection problems={report.problems} weekBuckets={report.week_buckets} />
      )}

      {/* S4: Trend Chart */}
      {report.problems.length > 0 && (
        <TrendChart problems={report.problems} weekBuckets={report.week_buckets} />
      )}

      {/* S5: Competitive Intelligence */}
      <CompetitorSection competitors={report.competitor_analysis} problems={report.problems} />

      {/* S6: Weekly Intelligence Brief */}
      <WeeklyBriefSection brief={report.weekly_brief} />

      {/* S7: Unanswered Review Tracker */}
      <UnansweredTracker
        unansweredCount={report.unanswered_count}
        oldestUnanswered={report.oldest_unanswered}
        onNavigateResponder={() => setPendingNavPage('responder')}
      />

      {/* S8: Business Health Score */}
      <HealthScoreSection
        score={report.health_score}
        breakdown={report.health_breakdown}
        problems={report.problems}
      />

      {/* Review Modal */}
      {reviewModal && (
        <ReviewModal
          indices={reviewModal.indices}
          matchReasons={reviewModal.matchReasons}
          onClose={() => setReviewModal(null)}
        />
      )}
    </div>
  )
}
