import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAppStore } from '../store/appStore'

// ── Types ──────────────────────────────────────────────────────────────────

type Problem = {
  rank:           number
  name:           string
  keywords:       string[]
  mention_count:  number
  trend:          'worsening' | 'improving' | 'stable'
  trend_pct:      number
  snippets:       string[]
  review_indices: number[]
  weekly_volume:  number[]
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
  week_label:    string
  weekly_stats:  {
    this_week_count:  number
    last_week_count:  number
    this_week_rating: number | null
    last_week_rating: number | null
  }
  narrative:     string
  top_priority:  string
  biggest_win:   string
  action_items:  string[]
}

type IntelReport = {
  problems:             Problem[]
  competitor_analysis:  CompetitorAnalysis[]
  weekly_brief:         WeeklyBrief
  health_score:         number
  potential_score:      number
  total_reviews:        number
  week_buckets:         string[]
  generated_at:         string
  cached?:              boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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

// ── Section 1: Problem Detection Header ───────────────────────────────────

function ProblemHeader({ problems, totalReviews, generatedAt }: {
  problems: Problem[]
  totalReviews: number
  generatedAt: string
}) {
  const criticalCount = problems.filter(p => p.mention_count > totalReviews * 0.1).length

  if (criticalCount === 0) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-900/20 to-[#0a1020] p-6 flex items-center justify-between gap-4">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent pointer-events-none" />
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
            <span className="text-2xl">✓</span>
          </div>
          <div>
            <p className="text-xl font-bold text-emerald-300">No critical issues this month</p>
            <p className="text-sm text-gray-400 mt-0.5">Based on {totalReviews} reviews · Keep up the great work</p>
          </div>
        </div>
        <p className="text-xs text-gray-600 relative z-10 shrink-0">Updated {relativeTime(generatedAt)}</p>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-900/20 to-[#0a1020] p-6 flex items-center justify-between gap-4">
      <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent pointer-events-none" />
      <div className="flex items-center gap-4 relative z-10">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
            <span className="text-2xl">⚠</span>
          </div>
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 animate-ping" />
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500" />
        </div>
        <div>
          <p className="text-2xl font-bold text-red-300">{criticalCount} Critical Issue{criticalCount !== 1 ? 's' : ''} Detected</p>
          <p className="text-sm text-gray-400 mt-0.5">Based on {totalReviews} reviews · Requires immediate attention</p>
        </div>
      </div>
      <p className="text-xs text-gray-600 relative z-10 shrink-0">Updated {relativeTime(generatedAt)}</p>
    </div>
  )
}

// ── Section 2: Problem Cards ───────────────────────────────────────────────

const RANK_STYLES = [
  { border: 'border-l-red-500',    bg: 'bg-red-500/5',    rankColor: 'text-red-500/20',    dot: 'bg-red-500',    bar: 'bg-red-500'    },
  { border: 'border-l-orange-500', bg: 'bg-orange-500/5', rankColor: 'text-orange-500/20', dot: 'bg-orange-500', bar: 'bg-orange-500' },
  { border: 'border-l-yellow-500', bg: 'bg-yellow-500/5', rankColor: 'text-yellow-500/20', dot: 'bg-yellow-500', bar: 'bg-yellow-500' },
  { border: 'border-l-gray-500',   bg: 'bg-gray-500/5',   rankColor: 'text-gray-500/20',   dot: 'bg-gray-500',   bar: 'bg-gray-600'   },
  { border: 'border-l-gray-600',   bg: 'bg-gray-600/5',   rankColor: 'text-gray-600/20',   dot: 'bg-gray-600',   bar: 'bg-gray-700'   },
]

function ProblemCard({ problem, maxCount, totalReviews, index, onViewReviews }: {
  problem: Problem
  maxCount: number
  totalReviews: number
  index: number
  onViewReviews: (indices: number[]) => void
}) {
  const style = RANK_STYLES[Math.min(index, RANK_STYLES.length - 1)]
  const barWidth = maxCount > 0 ? Math.round((problem.mention_count / maxCount) * 100) : 0
  const pct = totalReviews > 0 ? Math.round((problem.mention_count / totalReviews) * 100) : 0
  const isCritical = problem.rank === 1

  return (
    <div
      className={`relative rounded-xl border border-[#1e2d4a] border-l-4 ${style.border} ${style.bg} p-5 flex flex-col gap-4 transition-all duration-300 hover:border-[#2d3f5e] hover:-translate-y-0.5`}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Rank */}
      <div className="flex items-start justify-between">
        <span className={`text-8xl font-black leading-none select-none ${style.rankColor} absolute top-3 right-4 pointer-events-none`}>
          #{problem.rank}
        </span>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-1">
            {isCritical && (
              <span className="relative flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dot} opacity-75`} />
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${style.dot}`} />
              </span>
            )}
            <h3 className="text-base font-bold text-gray-100">{problem.name}</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-gray-200">{problem.mention_count}</span>
            <span className="text-xs text-gray-500">mentions · {pct}% of reviews</span>
          </div>
        </div>
      </div>

      {/* Volume bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Complaint Volume</span>
          <TrendBadge trend={problem.trend} pct={problem.trend_pct} />
        </div>
        <div className="h-2 bg-[#1e2d4a] rounded-full overflow-hidden">
          <div
            className={`h-full ${style.bar} rounded-full transition-all duration-700`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {/* Snippets */}
      {problem.snippets.length > 0 && (
        <div className="space-y-1.5">
          {problem.snippets.slice(0, 2).map((s, i) => (
            <blockquote key={i} className="text-xs text-gray-400 italic border-l-2 border-[#1e2d4a] pl-3 leading-relaxed">
              "{s}…"
            </blockquote>
          ))}
        </div>
      )}

      {/* CTA */}
      {problem.review_indices.length > 0 && (
        <button
          onClick={() => onViewReviews(problem.review_indices)}
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors self-start flex items-center gap-1 mt-auto"
        >
          View {problem.review_indices.length} related reviews →
        </button>
      )}
    </div>
  )
}

function TrendBadge({ trend, pct }: { trend: string; pct: number }) {
  if (trend === 'worsening') return (
    <span className="flex items-center gap-1 text-xs font-medium text-red-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-400" />
      </span>
      ↑ {pct}% Getting Worse
    </span>
  )
  if (trend === 'improving') return (
    <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      ↓ {pct}% Improving
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      → Stable
    </span>
  )
}

// ── Section 3: Trend Chart ─────────────────────────────────────────────────

function TrendChart({ problems, weekBuckets }: { problems: Problem[]; weekBuckets: string[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; values: { name: string; count: number; color: string }[] } | null>(null)

  const colors = ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#06b6d4']
  const top3 = problems.slice(0, 3)

  const maxVal = Math.max(1, ...top3.flatMap(p => p.weekly_volume))
  const chartH = 120
  const chartW = 500
  const padL = 24
  const padR = 8
  const padT = 8
  const padB = 20
  const innerW = chartW - padL - padR
  const innerH = chartH - padT - padB

  const xScale = (i: number) => padL + (i / (weekBuckets.length - 1)) * innerW
  const yScale = (v: number) => padT + innerH - (v / maxVal) * innerH

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="text-base font-bold text-gray-100">Are Your Problems Getting Better or Worse?</h2>
        <p className="text-xs text-gray-500 mt-0.5">Complaint volume over the last 8 weeks</p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {top3.map((p, i) => (
          <div key={p.name} className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: colors[i] }} />
            <span className="text-xs text-gray-400">{p.name}</span>
          </div>
        ))}
      </div>

      {/* SVG Chart */}
      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full"
          style={{ minWidth: '280px' }}
          onMouseLeave={() => setTooltip(null)}
        >
          {/* Y gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <line
              key={t}
              x1={padL} y1={padT + innerH * (1 - t)}
              x2={chartW - padR} y2={padT + innerH * (1 - t)}
              stroke="#1e2d4a" strokeWidth={1}
            />
          ))}

          {/* X labels */}
          {weekBuckets.map((label, i) => (
            <text
              key={i}
              x={xScale(i)} y={chartH - 4}
              textAnchor="middle"
              fontSize={8}
              fill="#4b5563"
            >
              {label}
            </text>
          ))}

          {/* Lines */}
          {top3.map((p, pi) => {
            const pts = p.weekly_volume
              .map((v, i) => `${xScale(i)},${yScale(v)}`)
              .join(' ')
            return (
              <polyline
                key={p.name}
                points={pts}
                fill="none"
                stroke={colors[pi]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )
          })}

          {/* Hover dots */}
          {weekBuckets.map((label, i) => (
            <rect
              key={i}
              x={xScale(i) - 12}
              y={padT}
              width={24}
              height={innerH}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={(e) => {
                const rect = (e.target as SVGRectElement).closest('svg')!.getBoundingClientRect()
                setTooltip({
                  x: xScale(i),
                  y: Math.min(...top3.map(p => yScale(p.weekly_volume[i] ?? 0))),
                  label,
                  values: top3.map((p, pi) => ({
                    name: p.name,
                    count: p.weekly_volume[i] ?? 0,
                    color: colors[pi],
                  })),
                })
              }}
            />
          ))}

          {/* Tooltip */}
          {tooltip && (
            <g>
              <line
                x1={tooltip.x} y1={padT}
                x2={tooltip.x} y2={padT + innerH}
                stroke="#374151" strokeWidth={1} strokeDasharray="3,2"
              />
              {top3.map((p, pi) => {
                const v = p.weekly_volume[weekBuckets.indexOf(tooltip.label)] ?? 0
                return (
                  <circle
                    key={pi}
                    cx={tooltip.x} cy={yScale(v)}
                    r={3} fill={colors[pi]}
                  />
                )
              })}
            </g>
          )}
        </svg>

        {/* Floating tooltip */}
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

// ── Section 4: Competitor Weakness Radar ──────────────────────────────────

function CompetitorRadar({ competitors }: { competitors: CompetitorAnalysis[] }) {
  if (competitors.length === 0) {
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
        <h2 className="text-base font-bold text-gray-100">What Your Competitors Are Struggling With</h2>
        <p className="text-xs text-gray-500 mt-0.5">These are your opportunities to stand out</p>
      </div>

      <div className="space-y-5">
        {competitors.map(comp => (
          <div key={comp.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0">
                {comp.name[0]?.toUpperCase()}
              </div>
              <div>
                <span className="text-sm font-semibold text-gray-200">{comp.name}</span>
                {comp.google_rating && (
                  <span className="ml-1.5 text-xs text-yellow-400">{comp.google_rating}⭐</span>
                )}
              </div>
            </div>

            <div className="pl-9 space-y-2">
              {comp.weaknesses.map(w => (
                <div key={w.problem_name} className="flex items-start justify-between gap-3 py-2 border-b border-[#1a2540] last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400">
                        <span className="text-orange-400 font-medium">{w.comp_mentions}</span> {w.problem_name} complaints
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-gray-500">Your score: </span>
                      <span className={`text-[11px] font-semibold ${w.my_score_pct >= 75 ? 'text-emerald-400' : w.my_score_pct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {w.my_score_pct}%
                      </span>
                    </div>
                  </div>
                  {w.opportunity && (
                    <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 whitespace-nowrap">
                      ✓ You win here — promote it
                    </span>
                  )}
                  {!w.opportunity && w.my_score_pct >= 50 && (
                    <span className="shrink-0 text-[10px] px-2 py-1 rounded-full bg-gray-500/15 text-gray-500 border border-gray-700 whitespace-nowrap">
                      → Neutral
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section 5: Weekly Intelligence Brief ──────────────────────────────────

function WeeklyBriefSection({ brief }: { brief: WeeklyBrief }) {
  const stats = brief.weekly_stats
  const reviewDelta = stats.this_week_count - stats.last_week_count
  const ratingDelta = stats.this_week_rating && stats.last_week_rating
    ? Math.round((stats.this_week_rating - stats.last_week_rating) * 10) / 10
    : null

  return (
    <div className="card overflow-hidden">
      {/* Header band */}
      <div className="px-5 py-4 border-b border-[#1e2d4a] bg-gradient-to-r from-purple-900/20 to-transparent flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Intelligence Brief</p>
          <h2 className="text-sm font-bold text-gray-200 mt-0.5">{brief.week_label}</h2>
        </div>
        <span className="text-xl">📰</span>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Left: stats */}
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

        {/* Right: highlights */}
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

      {/* Narrative */}
      {brief.narrative && (
        <div className="px-5 pb-4">
          <div className="bg-[#080d1a] rounded-xl p-4 border border-purple-500/10">
            <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-2">AI Summary</p>
            <p className="text-xs text-gray-300 leading-relaxed">{brief.narrative}</p>
          </div>
        </div>
      )}

      {/* Action items */}
      {brief.action_items && brief.action_items.length > 0 && (
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

function StatRow({ label, current, previous, delta, positiveIsUp, decimals = 0 }: {
  label: string
  current: number
  previous: number
  delta: number
  positiveIsUp: boolean
  decimals?: number
}) {
  const isPositive = positiveIsUp ? delta >= 0 : delta <= 0
  const color = delta === 0 ? 'text-gray-500' : isPositive ? 'text-emerald-400' : 'text-red-400'
  const arrow = delta === 0 ? '→' : delta > 0 ? '↑' : '↓'

  return (
    <div className="flex items-center justify-between py-2 border-b border-[#1a2540]">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-600">{previous.toFixed(decimals)}</span>
        <span className="text-gray-700">→</span>
        <span className="text-sm font-bold text-gray-200">{current.toFixed(decimals)}</span>
        <span className={`text-xs font-semibold ${color}`}>
          {arrow} {Math.abs(delta).toFixed(decimals)}
        </span>
      </div>
    </div>
  )
}

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
        {checked && <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
      </span>
      <span className={`text-xs leading-relaxed ${checked ? 'line-through text-gray-600' : 'text-gray-300'}`}>{text}</span>
    </button>
  )
}

// ── Section 6: Health Score ────────────────────────────────────────────────

function HealthScore({ score, potentialScore, problems, totalReviews }: {
  score: number
  potentialScore: number
  problems: Problem[]
  totalReviews: number
}) {
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
  const label = score >= 75 ? 'Excellent' : score >= 50 ? 'Good' : 'Needs Work'

  const lifters  = problems.filter(p => p.trend === 'improving').slice(0, 2)
  const draggers = problems.filter(p => p.trend !== 'improving' && p.mention_count > totalReviews * 0.08).slice(0, 3)

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
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${score}%`, backgroundColor: color }}
          />
        </div>

        {/* Potential overlay */}
        {potentialScore > score && (
          <div className="relative h-2 bg-[#1e2d4a] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full opacity-30 transition-all duration-1000"
              style={{ width: `${potentialScore}%`, backgroundColor: '#a855f7' }}
            />
            <div
              className="absolute top-0 h-full rounded-full opacity-60"
              style={{ left: `${score}%`, width: `${potentialScore - score}%`, backgroundColor: '#a855f7' }}
            />
          </div>
        )}

        {potentialScore > score && (
          <p className="text-xs text-purple-400">
            ✦ Fix your top {Math.min(3, problems.length)} issues → score reaches <span className="font-bold">{potentialScore}/100</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {draggers.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider">↓ Dragging You Down</p>
            {draggers.map(p => (
              <div key={p.name} className="flex items-center gap-2 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                {p.name}
                <span className="text-red-500 ml-auto">-{Math.round((p.mention_count / Math.max(totalReviews, 1)) * 20)}pts</span>
              </div>
            ))}
          </div>
        )}
        {lifters.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">↑ Lifting You Up</p>
            {lifters.map(p => (
              <div key={p.name} className="flex items-center gap-2 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                {p.name} improving
                <span className="text-emerald-500 ml-auto">+{p.trend_pct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`bg-[#1e2d4a]/60 rounded-lg animate-pulse ${className}`} />
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-56" />
    </div>
  )
}

// ── Review Filter Modal ────────────────────────────────────────────────────

function ReviewModal({ indices, onClose }: { indices: number[]; onClose: () => void }) {
  const { activeBusiness } = useAppStore()
  const [reviews, setReviews] = useState<{ review_text: string; reviewer_name: string; rating: number | null; sentiment: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeBusiness || indices.length === 0) { setLoading(false); return }
    supabase
      .from('reviews')
      .select('review_text, reviewer_name, rating, sentiment')
      .eq('business_id', activeBusiness.id)
      .then(({ data }) => {
        if (data) {
          setReviews(indices.map(i => data[i]).filter(Boolean))
        }
        setLoading(false)
      })
  }, [])

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2d4a]">
          <p className="text-sm font-semibold text-gray-200">Related Reviews ({indices.length})</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {loading && <div className="text-center text-xs text-gray-500 py-6">Loading reviews…</div>}
          {reviews.map((r, i) => (
            <div key={i} className="bg-[#080d1a] border border-[#1e2d4a] rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">{r.reviewer_name || 'Anonymous'}</span>
                {r.rating && <span className="text-xs text-yellow-400">{'⭐'.repeat(Math.min(r.rating, 5))}</span>}
                {r.sentiment && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    r.sentiment === 'positive' ? 'bg-emerald-500/15 text-emerald-400' :
                    r.sentiment === 'negative' ? 'bg-red-500/15 text-red-400' :
                    'bg-gray-500/15 text-gray-400'
                  }`}>{r.sentiment}</span>
                )}
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{r.review_text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function Intelligence() {
  const { user } = useAuth()
  const { activeBusiness } = useAppStore()

  const [report, setReport]     = useState<IntelReport | null>(null)
  const [loading, setLoading]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError]       = useState('')
  const [reviewModal, setReviewModal] = useState<number[] | null>(null)

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

      const data: IntelReport = await res.json()
      setReport(data)
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

      {/* S1: Problem header banner */}
      <ProblemHeader
        problems={report.problems}
        totalReviews={report.total_reviews}
        generatedAt={report.generated_at}
      />

      {/* S2: Problem cards */}
      {report.problems.length > 0 ? (
        <>
          <div>
            <h2 className="text-base font-bold text-gray-100 mb-1">Top Problems</h2>
            <p className="text-xs text-gray-500">Detected from {report.total_reviews} reviews via keyword matching</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {report.problems.slice(0, 3).map((p, i) => (
              <ProblemCard
                key={p.name}
                problem={p}
                maxCount={maxCount}
                totalReviews={report.total_reviews}
                index={i}
                onViewReviews={setReviewModal}
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
                  onViewReviews={setReviewModal}
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

      {/* S3: Trend chart */}
      {report.problems.length > 0 && (
        <TrendChart problems={report.problems} weekBuckets={report.week_buckets} />
      )}

      {/* S4: Competitor radar */}
      <CompetitorRadar competitors={report.competitor_analysis} />

      {/* S5: Weekly brief */}
      <WeeklyBriefSection brief={report.weekly_brief} />

      {/* S6: Health score */}
      <HealthScore
        score={report.health_score}
        potentialScore={report.potential_score}
        problems={report.problems}
        totalReviews={report.total_reviews}
      />

      {/* Review modal */}
      {reviewModal && (
        <ReviewModal indices={reviewModal} onClose={() => setReviewModal(null)} />
      )}
    </div>
  )
}

// ── Page header (shared) ───────────────────────────────────────────────────

function Header({ onRefresh, generating, report }: {
  onRefresh: () => void
  generating: boolean
  report: IntelReport | null
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-100">Intelligence</h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {report?.cached && <span className="text-xs text-emerald-500">🗄 From cache</span>}
          {report?.generated_at && (
            <p className="text-xs text-gray-500">
              {report.cached ? '·' : ''} Last generated {relativeTime(report.generated_at)} · Cached 7 days
            </p>
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
