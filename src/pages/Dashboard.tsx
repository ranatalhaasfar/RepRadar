import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAppStore } from '../store/appStore'
import { lcSave, lcLoad, lcClear } from '../lib/localCache'
import type { Business, Review } from '../lib/supabase'
import type { SentimentPoint, Category } from '../store/appStore'

// ── Outscraper limits ──────────────────────────────────────────────────────

const MAX_REFRESH_FETCH = 200

// ── Types ──────────────────────────────────────────────────────────────────

type AnalysisResult = {
  sentimentCounts: { positive: number; negative: number; neutral: number }
  reputationScore: number
  topKeywords:     string[]
  reviewSentiments: string[]
}

// keyword with optional count suffix "word×12"
type KeywordEntry = { word: string; count: number }

// ── Helpers ────────────────────────────────────────────────────────────────

function buildTimeline(reviews: Review[]): SentimentPoint[] {
  // Group by month using reviewed_at; fall back to bucket index if no dates
  const monthMap = new Map<string, { positive: number; negative: number; total: number; ts: number }>()

  for (const r of reviews) {
    const raw = r.reviewed_at ?? r.created_at
    let label: string
    let ts: number
    if (raw) {
      const d = new Date(raw)
      label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      ts = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    } else {
      label = 'Unknown'
      ts = 0
    }
    if (!monthMap.has(label)) monthMap.set(label, { positive: 0, negative: 0, total: 0, ts })
    const b = monthMap.get(label)!
    b.total++
    if (r.sentiment === 'positive') b.positive++
    else if (r.sentiment === 'negative') b.negative++
  }

  // If all reviews lack dates, fall back to bucket-based with ordinal labels
  if (monthMap.size <= 1 && monthMap.has('Unknown')) {
    const bucketSize = Math.max(1, Math.ceil(reviews.length / 8))
    const buckets: { positive: number; negative: number; total: number }[] = []
    for (let i = 0; i < reviews.length; i++) {
      const bi = Math.floor(i / bucketSize)
      if (!buckets[bi]) buckets[bi] = { positive: 0, negative: 0, total: 0 }
      buckets[bi].total++
      if (reviews[i].sentiment === 'positive') buckets[bi].positive++
      else if (reviews[i].sentiment === 'negative') buckets[bi].negative++
    }
    return buckets.map((b, i) => ({
      date:     `Group ${i + 1}`,
      positive: b.total ? Math.round((b.positive / b.total) * 100) : 0,
      negative: b.total ? Math.round((b.negative / b.total) * 100) : 0,
    }))
  }

  return Array.from(monthMap.entries())
    .sort((a, b) => a[1].ts - b[1].ts)
    .map(([label, b]) => ({
      date:     label,
      positive: b.total ? Math.round((b.positive / b.total) * 100) : 0,
      negative: b.total ? Math.round((b.negative / b.total) * 100) : 0,
    }))
}

function computeStats(revs: Review[]) {
  const counts = { positive: 0, negative: 0, neutral: 0 }
  for (const r of revs) {
    if (r.sentiment === 'positive') counts.positive++
    else if (r.sentiment === 'negative') counts.negative++
    else if (r.sentiment === 'neutral') counts.neutral++
  }
  const total = counts.positive + counts.negative + counts.neutral
  const score = total === 0
    ? 0
    : Math.round(((counts.positive + counts.neutral * 0.5) / total) * 100)
  return { counts, score }
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function isStale(ts: string | null | undefined, days = 7): boolean {
  if (!ts) return true
  return Date.now() - new Date(ts).getTime() > days * 24 * 60 * 60 * 1000
}

function relativeDate(ts: string | null | undefined): string {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const d = Math.floor(diff / 86_400_000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 7)  return `${d} days ago`
  if (d < 30) return `${Math.floor(d / 7)} week${Math.floor(d / 7) > 1 ? 's' : ''} ago`
  if (d < 365) return `${Math.floor(d / 30)} month${Math.floor(d / 30) > 1 ? 's' : ''} ago`
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) > 1 ? 's' : ''} ago`
}

const VERDICT_CONFIG: Record<string, { bg: string; border: string; badge: string; text: string }> = {
  'Strength':          { bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', badge: 'bg-emerald-500/20 text-emerald-300', text: 'text-emerald-400' },
  'Needs Improvement': { bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   badge: 'bg-amber-500/20 text-amber-300',   text: 'text-amber-400'   },
  'Critical Issue':    { bg: 'bg-red-500/10',     border: 'border-red-500/25',     badge: 'bg-red-500/20 text-red-300',      text: 'text-red-400'     },
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ icon, value, label, sub, color = 'text-gray-100', glow = '' }: {
  icon: string; value: string | number; label: string; sub?: string; color?: string; glow?: string
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-[#1e2d4a] bg-gradient-to-br from-[#0f1629] to-[#0a0f1e] p-5 flex items-start gap-4 transition-all hover:border-[#2d3f5e]`}>
      {glow && <div className={`absolute top-0 right-0 w-24 h-24 ${glow} opacity-[0.08] rounded-full -translate-y-8 translate-x-8 blur-2xl pointer-events-none`} />}
      <span className="text-2xl mt-0.5 relative z-10">{icon}</span>
      <div className="min-w-0 relative z-10">
        <p className={`text-3xl font-extrabold ${color} leading-none mb-1 tracking-tight`}>{value}</p>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function ReputationGauge({ score }: { score: number }) {
  // viewBox 200×145 — arc center at (100, 95), radius 78, strokeWidth 14
  // Extra height below center gives room for score text + labels.
  // Semicircle: 180° (left) → 0° (right) through top.
  // strokeLinecap="butt" so segments meet cleanly with no overlap/gap.

  const cx = 100, cy = 95, r = 78
  const C    = 2 * Math.PI * r   // ≈ 490.09
  const semi = C / 2             // ≈ 245.04
  const dpx  = semi / 180        // units per degree ≈ 1.3613

  // Arc segment lengths (degrees × dpx)
  const redLen    = 72 * dpx   // 180°→108°  (0–40)
  const orangeLen = 54 * dpx   // 108°→54°   (41–70)
  const greenLen  = 54 * dpx   //  54°→0°    (71–100)

  // Needle: score 0→100 maps to angle 180°→0°
  const angleDeg = 180 - score * 1.8
  const angleRad = (angleDeg * Math.PI) / 180
  const nLen = 66
  const nx = cx + nLen * Math.cos(angleRad)
  const ny = cy - nLen * Math.sin(angleRad)

  const scoreColor = score <= 40 ? '#ef4444' : score <= 70 ? '#f59e0b' : '#22c55e'

  // All colored arcs share these props
  const arc = {
    cx, cy, r,
    fill: 'none',
    strokeWidth: 14,
    strokeLinecap: 'butt' as const,   // butt = no caps → seamless joins
    transform: `rotate(-180 ${cx} ${cy})`,
  }

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 145" className="w-full max-w-[260px]"
        aria-label={`Reputation score: ${score} out of 100`}>

        {/* Dark background track */}
        <circle {...arc} stroke="#1e2d4a" strokeDasharray={`${semi} ${C}`} />

        {/* Red 0–40 */}
        <circle {...arc} stroke="#ef4444"
          strokeDasharray={`${redLen} ${C}`}
          strokeDashoffset={0} />

        {/* Orange 41–70 */}
        <circle {...arc} stroke="#f59e0b"
          strokeDasharray={`${orangeLen} ${C}`}
          strokeDashoffset={-redLen} />

        {/* Green 71–100 */}
        <circle {...arc} stroke="#22c55e"
          strokeDasharray={`${greenLen} ${C}`}
          strokeDashoffset={-(redLen + orangeLen)} />

        {/* Needle line */}
        <line x1={cx} y1={cy} x2={nx} y2={ny}
          stroke="white" strokeWidth="2.5" strokeLinecap="round" />

        {/* Hub */}
        <circle cx={cx} cy={cy} r="6" fill="#94a3b8" />
        <circle cx={cx} cy={cy} r="3" fill="#0f172a" />

        {/* Score — below center, clear of needle */}
        <text x={cx} y={cy + 18} textAnchor="middle"
          fill={scoreColor} fontSize="26" fontWeight="800" fontFamily="inherit">
          {score}
        </text>
        <text x={cx} y={cy + 30} textAnchor="middle"
          fill="#6b7280" fontSize="10" fontFamily="inherit">
          /100
        </text>

        {/* Scale labels at very bottom */}
        <text x="20"  y="142" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="inherit">0</text>
        <text x={cx}  y="142" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="inherit">50</text>
        <text x="180" y="142" textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="inherit">100</text>

      </svg>
    </div>
  )
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { color: string; name: string; value: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-bold">{p.value}%</span></p>
      ))}
    </div>
  )
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating === null) return null
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`text-sm leading-none ${i <= rating ? 'text-yellow-400' : 'text-gray-700'}`}>★</span>
      ))}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()

  // ── Zustand store ──
  const {
    activeBusiness, activeBusinessId,
    business, reviews, dashboardLoadedAt, dashboardBusinessId, setDashboard,
    categories, categoriesLoadedAt, categoriesBusinessId, setCategories,
    setPendingReviewText, setPendingNavPage,
  } = useAppStore()

  // ── Local UI state (not persisted — fine to reset on reload) ──
  const [loading,         setLoading]         = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError,   setAnalysisError]   = useState('')
  const [error,           setError]           = useState('')
  const [fetchingReviews, setFetchingReviews] = useState(false)
  const [fetchError,      setFetchError]      = useState('')
  const [fromCache,       setFromCache]       = useState(false)
  const [keywords,        setKeywords]        = useState<string[]>([])
  const [timeline,        setTimeline]        = useState<SentimentPoint[]>([])
  const [initializing,    setInitializing]    = useState(true)

  // ── Category state ──
  const [catLoading,      setCatLoading]      = useState(false)
  const [catError,        setCatError]        = useState('')
  const [activeCategory,  setActiveCategory]  = useState<string | null>(null)
  const [catVisibleCount, setCatVisibleCount] = useState(10)

  // ── Review expand state ──
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set())

  // ── On mount / business switch: load from store → Supabase (never auto-call Anthropic) ──

  useEffect(() => {
    if (!user) return
    initDashboard()
  }, [user?.id, activeBusinessId])

  useEffect(() => {
    if (!user || !activeBusiness) return
    loadCategories()
  }, [user?.id, activeBusinessId])

  const initDashboard = async () => {
    if (!user) return
    setError('')

    const bizData = activeBusiness
    if (!bizData) { setInitializing(false); return }

    // 1️⃣ Zustand store hit — render instantly
    if (dashboardBusinessId === bizData.id && dashboardLoadedAt !== null && reviews.length > 0) {
      console.log('[Dashboard] ✅ Layer 1 hit — Zustand store')
      setKeywords(Array.isArray(bizData.keywords) ? bizData.keywords : [])
      setTimeline(buildTimeline(reviews))
      setFromCache(true)
      setInitializing(false)
      return
    }

    // 2️⃣ localStorage hit — survives browser refresh
    const lsData = lcLoad<{ business: Business; reviews: Review[] }>('reviews', bizData.id)
    if (lsData && lsData.data.reviews.length > 0) {
      console.log('[Dashboard] ✅ Layer 2 hit — localStorage', `(saved ${new Date(lsData.savedAt).toLocaleTimeString()})`)
      const { business: cachedBiz, reviews: cachedRevs } = lsData.data
      setDashboard(cachedBiz, cachedRevs, bizData.id)
      setKeywords(Array.isArray(cachedBiz.keywords) ? cachedBiz.keywords : [])
      setTimeline(buildTimeline(cachedRevs))
      setFromCache(true)
      setInitializing(false)
      return
    }

    // 3️⃣ Supabase — permanent DB storage
    console.log('[Dashboard] 🗄 Layer 3 — fetching from Supabase')
    setLoading(true)
    try {
      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('*')
        .eq('business_id', bizData.id)
        .order('created_at', { ascending: true })
      if (revErr) throw revErr

      const revs: Review[] = revData ?? []

      // Save to Layer 1 (Zustand) and Layer 2 (localStorage)
      setDashboard(bizData as Business, revs, bizData.id)
      if (revs.length > 0) {
        lcSave('reviews', bizData.id, { business: bizData as Business, reviews: revs })
        console.log('[Dashboard] ✅ Layer 3 hit — Supabase, saved to localStorage')
      }

      if (revs.length === 0) {
        setInitializing(false)
        setLoading(false)
        return
      }

      const unanalyzedRevs = revs.filter(r => r.sentiment === null)
      const hasKeywords = Array.isArray(bizData.keywords) && bizData.keywords.length > 0

      if (unanalyzedRevs.length === 0) {
        // All analyzed — load from cache
        console.log('[Dashboard] ✅ All reviews analyzed — loading from cache, NO Anthropic call')
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        setFromCache(true)
      } else {
        // New unanalyzed reviews — run analysis
        console.log(`[Dashboard] 🌐 ${unanalyzedRevs.length} new unanalyzed reviews — calling Anthropic`)
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        await runAnalysis(unanalyzedRevs, bizData.id, revs)
      }
    } catch (e: unknown) {
      console.error('[Dashboard] initDashboard error:', e)
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
      setInitializing(false)
    }
  }

  // ── Manual full reload (Refresh button) ─────────────────────────────────

  const reloadDashboard = async (forceReanalyze = false) => {
    if (!user) return
    setLoading(true)
    setError('')
    setAnalysisError('')
    setFromCache(false)
    try {
      const bizData = activeBusiness
      if (!bizData) return

      // Clear Layer 2 (localStorage) so we reload fresh from Supabase
      lcClear('reviews', bizData.id)

      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('*')
        .eq('business_id', bizData.id)
        .order('created_at', { ascending: true })
      if (revErr) throw revErr

      const revs: Review[] = revData ?? []
      setDashboard(bizData as Business, revs, bizData.id)
      if (revs.length > 0) {
        lcSave('reviews', bizData.id, { business: bizData as Business, reviews: revs })
      }

      if (revs.length === 0) return

      const unanalyzedRevs = revs.filter(r => r.sentiment === null)
      const hasKeywords = Array.isArray(bizData.keywords) && bizData.keywords.length > 0

      if (!forceReanalyze && unanalyzedRevs.length === 0) {
        console.log('[Dashboard] ✅ Refreshed from cache — NO Anthropic call')
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        setFromCache(true)
      } else if (forceReanalyze) {
        console.log('[Dashboard] 🌐 Force re-analyze — calling Anthropic')
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        await runAnalysis(revs, bizData.id, revs)
      } else {
        console.log(`[Dashboard] 🌐 ${unanalyzedRevs.length} unanalyzed — calling Anthropic`)
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        await runAnalysis(unanalyzedRevs, bizData.id, revs)
      }
    } catch (e: unknown) {
      console.error('[Dashboard] reloadDashboard error:', e)
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const runAnalysis = async (revsToAnalyze: Review[], businessId: string, allRevs: Review[]) => {
    setAnalysisLoading(true)
    setAnalysisError('')
    try {
      // Split: reviews with text go to AI; rating-only reviews get star-based sentiment
      const withText   = revsToAnalyze.filter(r => r.review_text.trim().length > 0)
      const ratingOnly = revsToAnalyze.filter(r => r.review_text.trim().length === 0)

      const starSentiment = (rating: number | null): 'positive' | 'negative' | 'neutral' =>
        rating !== null && rating >= 4 ? 'positive' : rating !== null && rating <= 2 ? 'negative' : 'neutral'

      const sentimentMap = new Map<string, 'positive' | 'negative' | 'neutral'>()

      // Assign star-based sentiment for rating-only reviews immediately
      ratingOnly.forEach(r => sentimentMap.set(r.id, starSentiment(r.rating)))

      // Send only text reviews to AI (skip if none)
      if (withText.length > 0) {
        const res = await fetch('/api/analyze-reviews', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ reviews: withText.map(r => r.review_text) }),
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error ?? `API error ${res.status}`)

        const data: AnalysisResult = payload
        withText.forEach((r, i) => {
          sentimentMap.set(r.id, (data.reviewSentiments[i] ?? 'neutral') as 'positive' | 'negative' | 'neutral')
        })

        // Update business-level stats from AI response
        const mergedRevs: Review[] = allRevs.map(r =>
          sentimentMap.has(r.id) ? { ...r, sentiment: sentimentMap.get(r.id)! } : r
        )
        const { score: newScore } = computeStats(mergedRevs)
        const now = new Date().toISOString()
        await supabase.from('businesses').update({
          total_reviews:    mergedRevs.length,
          reputation_score: data.reputationScore ?? newScore,
          keywords:         data.topKeywords ?? [],
          analyzed_at:      now,
        }).eq('id', businessId)

        setTimeline(buildTimeline(mergedRevs))
        setKeywords(data.topKeywords ?? [])

        const { data: refreshed } = await supabase.from('businesses').select('*').eq('id', businessId).single()
        if (refreshed) {
          setDashboard(refreshed as Business, mergedRevs, businessId)
          lcSave('reviews', businessId, { business: refreshed as Business, reviews: mergedRevs })
          console.log('[Dashboard] ✅ Analysis complete — saved to localStorage')
        }
      }

      for (const r of revsToAnalyze) {
        await supabase.from('reviews').update({ sentiment: sentimentMap.get(r.id) }).eq('id', r.id)
      }

      // If there were no text reviews, still update business stats / local state
      if (withText.length === 0) {
        const mergedRevs: Review[] = allRevs.map(r =>
          sentimentMap.has(r.id) ? { ...r, sentiment: sentimentMap.get(r.id)! } : r
        )
        const { score: newScore } = computeStats(mergedRevs)
        const now = new Date().toISOString()
        await supabase.from('businesses').update({
          total_reviews: mergedRevs.length,
          reputation_score: newScore,
          analyzed_at:  now,
        }).eq('id', businessId)

        setTimeline(buildTimeline(mergedRevs))

        const { data: refreshed } = await supabase.from('businesses').select('*').eq('id', businessId).single()
        if (refreshed) {
          setDashboard(refreshed as Business, mergedRevs, businessId)
          lcSave('reviews', businessId, { business: refreshed as Business, reviews: mergedRevs })
          console.log('[Dashboard] ✅ Analysis complete (rating-only) — saved to localStorage')
        }
      }

    } catch (e: unknown) {
      console.error('[Dashboard] runAnalysis error:', e)
      setAnalysisError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const fetchNewReviews = async () => {
    if (!business?.place_id || !user) return

    if (typeof business.place_id !== 'string' || !business.place_id.startsWith('ChIJ')) {
      setFetchError('Invalid business ID — cannot fetch reviews. Please re-add this business.')
      return
    }

    if (!isStale(business.reviews_fetched_at, 7)) {
      setFetchError('Reviews were fetched less than 7 days ago. Please wait before refreshing again.')
      return
    }

    setFetchingReviews(true)
    setFetchError('')
    try {
      const res = await fetch('/api/outscraper-reviews', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ place_id: business.place_id, limit: MAX_REFRESH_FETCH, sort: 'newest' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to fetch reviews')
      }
      const { reviews: fetched } = await res.json()

      if (fetched.length > 0) {
        await supabase.from('reviews').delete().eq('business_id', business.id)
        const rows = fetched.map((r: {
          reviewer_name: string; review_text: string
          rating: number | null; reviewed_at: string | null
        }) => ({
          business_id:   business.id,
          user_id:       user.id,
          review_text:   r.review_text,
          reviewer_name: r.reviewer_name,
          rating:        r.rating,
          reviewed_at:   r.reviewed_at,
          sentiment:     null,
        }))
        await supabase.from('reviews').insert(rows)
      }

      await supabase.from('businesses').update({ reviews_fetched_at: new Date().toISOString() }).eq('id', business.id)

      // Full reload with fresh data
      await reloadDashboard(false)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch reviews')
    } finally {
      setFetchingReviews(false)
    }
  }

  // ── Category load / generate ─────────────────────────────────────────

  const loadCategories = async () => {
    if (!activeBusiness) return

    // 1️⃣ Zustand store hit
    if (categoriesBusinessId === activeBusiness.id && categoriesLoadedAt !== null && categories.length > 0) {
      console.log('[Dashboard] ✅ Categories Layer 1 hit — Zustand store')
      return
    }

    // 2️⃣ localStorage hit
    const lsCats = lcLoad<Category[]>('categories', activeBusiness.id)
    if (lsCats && lsCats.data.length > 0) {
      console.log('[Dashboard] ✅ Categories Layer 2 hit — localStorage')
      setCategories(lsCats.data, activeBusiness.id)
      return
    }

    // 3️⃣ Supabase
    setCatError('')
    try {
      const { data, error: dbErr } = await supabase
        .from('categories')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .order('review_count', { ascending: false })
      if (dbErr) throw dbErr
      if (data && data.length > 0) {
        console.log('[Dashboard] ✅ Categories Layer 3 hit — Supabase')
        const mapped = data.map((row: Record<string, unknown>) => ({
          ...row,
          reviewIndices: (row.review_indices as number[]) ?? [],
        })) as Category[]
        setCategories(mapped, activeBusiness.id)
        lcSave('categories', activeBusiness.id, mapped)
      }
    } catch (e: unknown) {
      console.error('[Dashboard] loadCategories error:', e)
    }
  }

  const generateCategories = async () => {
    if (!activeBusiness || reviews.length === 0) return
    setCatLoading(true)
    setCatError('')
    try {
      const res = await fetch('/api/generate-categories', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reviews }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? `API error ${res.status}`)

      const newCats: Category[] = payload.categories
      // Clear old localStorage before saving fresh
      lcClear('categories', activeBusiness.id)
      setCategories(newCats, activeBusiness.id)
      lcSave('categories', activeBusiness.id, newCats)
      console.log('[Dashboard] ✅ Categories saved to localStorage + Zustand')

      // Persist to Supabase — delete old, insert new
      await supabase.from('categories').delete().eq('business_id', activeBusiness.id)
      const rows = newCats.map(c => ({
        business_id:      activeBusiness.id,
        name:             c.name,
        emoji:            c.emoji,
        review_count:     c.review_count,
        sentiment_score:  c.sentiment_score,
        verdict:          c.verdict,
        example_snippets: c.example_snippets,
        review_indices:   c.reviewIndices ?? [],
      }))
      await supabase.from('categories').insert(rows)
    } catch (e: unknown) {
      setCatError(e instanceof Error ? e.message : 'Category generation failed')
    } finally {
      setCatLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (initializing || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-500 text-sm">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading your dashboard…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6 text-red-400 text-sm flex items-center gap-3">
        <span>⚠ {error}</span>
        <button onClick={() => reloadDashboard()} className="underline hover:no-underline">Retry</button>
      </div>
    )
  }

  const { counts: sc, score: dbScore } = computeStats(reviews)
  const total = sc.positive + sc.negative + sc.neutral || 1
  const positivePercent = Math.round((sc.positive / total) * 100)
  const negativePercent = Math.round((sc.negative / total) * 100)
  const reputationScore = business?.reputation_score ?? dbScore
  const hasAnalysis = reviews.some(r => r.sentiment !== null)
  const analyzedAt = formatTimestamp(business?.analyzed_at)
  const fetchedAt  = formatTimestamp(business?.reviews_fetched_at)
  const reviewsStale = isStale(business?.reviews_fetched_at, 7)

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-100 tracking-tight">
            {business?.name ?? 'Dashboard'}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-gray-500 text-sm">{business?.type} · {business?.location}</span>
            {business?.google_rating !== null && business?.google_rating !== undefined && (
              <span className="flex items-center gap-1 text-sm">
                <span className="text-yellow-400">★</span>
                <span className="font-semibold text-gray-200">{business.google_rating.toFixed(1)}</span>
                <span className="text-gray-600 text-xs">Google</span>
              </span>
            )}
            {analysisLoading && (
              <span className="text-purple-400 animate-pulse text-xs">· Analyzing…</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {fromCache && !analysisLoading && (
              <span className="text-[11px] text-emerald-600">✓ Loaded from cache</span>
            )}
            {fetchedAt && (
              <p className="text-[11px] text-gray-600">{fromCache ? '·' : ''} Last updated: {fetchedAt}</p>
            )}
            {analyzedAt && !analysisLoading && (
              <p className="text-[11px] text-gray-600">· Analyzed: {analyzedAt}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {business?.place_id && (
            <button
              onClick={fetchNewReviews}
              disabled={fetchingReviews || analysisLoading}
              title="Fetch latest reviews from Google"
              className="min-h-[44px] px-3 py-2 text-xs text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              {fetchingReviews ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Fetching…
                </>
              ) : '↓ Fetch Reviews'}
            </button>
          )}
          {hasAnalysis && (
            <button
              onClick={() => reloadDashboard(true)}
              disabled={analysisLoading || fetchingReviews}
              title="Force re-analysis with Anthropic AI"
              className="min-h-[44px] px-3 py-2 text-xs text-purple-400 border border-purple-500/30 hover:bg-purple-500/10 rounded-lg transition-all disabled:opacity-40"
            >
              ✨ Re-analyze
            </button>
          )}
          <button
            onClick={() => reloadDashboard(false)}
            disabled={loading || analysisLoading || fetchingReviews}
            className="btn-primary min-h-[44px] px-4 py-2 text-xs flex items-center gap-1.5"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Stale reviews banner */}
      {reviewsStale && business?.place_id && !fetchingReviews && (
        <div className="card p-3 border-amber-500/20 flex items-center justify-between gap-3">
          <span className="text-amber-400 text-xs">
            ⚠ Your reviews are {fetchedAt ? 'over 7 days old' : 'not yet fetched from Google'}.
          </span>
          <button onClick={fetchNewReviews} className="text-xs text-amber-400 underline hover:no-underline">
            Fetch now
          </button>
        </div>
      )}

      {/* Fetch error banner */}
      {fetchError && (
        <div className="card p-3 border-red-500/30 flex items-center gap-3">
          <span className="text-red-400 text-xs">⚠ Fetch error: {fetchError}</span>
          <button onClick={() => setFetchError('')} className="text-xs text-red-400 underline hover:no-underline">Dismiss</button>
        </div>
      )}

      {/* Analysis error banner */}
      {analysisError && (
        <div className="card p-3 border-amber-500/30 flex items-center gap-3">
          <span className="text-amber-400 text-xs">⚠ Analysis error: {analysisError}</span>
          <button
            onClick={() => business && runAnalysis(reviews, business.id, reviews)}
            className="text-xs text-amber-400 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard icon="📝" value={reviews.length}
          label="Total Reviews" glow="bg-blue-400"
          sub={business?.google_rating ? `${business.google_rating.toFixed(1)}★ Google rating` : undefined}
        />
        <StatCard icon="😊" value={`${positivePercent}%`}   label="Positive"         color="text-emerald-400" glow="bg-emerald-400" sub={`${sc.positive} reviews`} />
        <StatCard icon="😞" value={`${negativePercent}%`}   label="Negative"         color="text-red-400"     glow="bg-red-400"     sub={`${sc.negative} reviews`} />
        <StatCard icon="🏆" value={reputationScore}          label="Reputation Score" color="text-purple-400"  glow="bg-purple-400"  sub="Out of 100" />
      </div>

      {/* Action Items */}
      {hasAnalysis && (() => {
        const urgentNeg = reviews.filter(r => r.sentiment === 'negative' && (r.rating === null || r.rating <= 2))
        const unanswered = reviews.filter(r => r.sentiment === 'negative')
        const weakCat   = categories.find(c => c.verdict === 'Critical Issue')
        const starCat   = categories.find(c => c.verdict === 'Strength')
        const items: { icon: string; color: string; bg: string; border: string; title: string; desc: string; action?: string; page?: string; reviewText?: string }[] = []

        if (unanswered.length > 0) {
          items.push({
            icon: '⚠️', color: 'text-red-300', bg: 'bg-red-500/8', border: 'border-red-500/25',
            title: `${unanswered.length} negative review${unanswered.length > 1 ? 's' : ''} need a response`,
            desc:  'Responding to negative reviews publicly shows you care and can recover trust.',
            action: 'Respond now', page: 'responder', reviewText: unanswered[0]?.review_text,
          })
        }
        if (weakCat) {
          items.push({
            icon: '🔧', color: 'text-amber-300', bg: 'bg-amber-500/8', border: 'border-amber-500/25',
            title: `"${weakCat.name}" is a critical weakness`,
            desc:  `${weakCat.review_count} reviews mention this area negatively. Address it to boost your score.`,
          })
        }
        if (starCat) {
          items.push({
            icon: '🌟', color: 'text-emerald-300', bg: 'bg-emerald-500/8', border: 'border-emerald-500/25',
            title: `Customers love your "${starCat.name}"`,
            desc:  'Highlight this strength in your marketing to attract more customers.',
          })
        }
        if (urgentNeg.length === 0 && !weakCat && !starCat) return null
        return (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1">Action Items</h3>
            {items.map((item, i) => (
              <div key={i} className={`flex items-start gap-3 rounded-xl border ${item.bg} ${item.border} px-4 py-3`}>
                <span className="text-lg mt-0.5 shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${item.color}`}>{item.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
                {item.action && item.page && (
                  <button
                    onClick={() => {
                      if (item.reviewText) setPendingReviewText(item.reviewText)
                      setPendingNavPage(item.page as string)
                    }}
                    className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border ${item.border} ${item.color} hover:bg-white/5 transition-colors`}
                  >
                    {item.action} →
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Gauge + Chart */}
      {hasAnalysis && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-[#1e2d4a] bg-gradient-to-br from-[#0f1629] to-[#0a0f1e] p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Overall Score</h3>
            <p className="text-xs text-gray-600 mb-4">Calculated from {reviews.length} reviews</p>
            <ReputationGauge score={reputationScore} />
          </div>
          <div className="rounded-xl border border-[#1e2d4a] bg-gradient-to-br from-[#0f1629] to-[#0a0f1e] p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">Sentiment Trend</h3>
            <p className="text-xs text-gray-600 mb-4">Positive vs negative across your reviews</p>
            {timeline.length > 1 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={timeline} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="positive" name="Positive" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="negative" name="Negative" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-gray-600 text-center py-8">Add more reviews for a trend chart.</p>
            )}
          </div>
        </div>
      )}

      {/* First-run analysis banner */}
      {analysisLoading && !hasAnalysis && (
        <div className="card p-4 flex items-center gap-3 border-purple-500/20">
          <svg className="animate-spin h-4 w-4 text-purple-400 flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-purple-300">Analyzing your reviews with AI… this takes a few seconds.</p>
        </div>
      )}

      {/* Keywords */}
      {keywords.length > 0 && (() => {
        // Parse "word×12" format or just plain words
        const parsed: KeywordEntry[] = keywords.map((kw, i) => {
          const m = kw.match(/^(.+?)[\s×x*](\d+)$/)
          return m ? { word: m[1].trim(), count: parseInt(m[2]) } : { word: kw, count: keywords.length - i }
        })
        const maxCount = Math.max(...parsed.map(k => k.count), 1)
        return (
          <div className="rounded-xl border border-[#1e2d4a] bg-gradient-to-br from-[#0f1629] to-[#0a0f1e] p-6">
            <h3 className="text-sm font-bold text-gray-100 mb-4 uppercase tracking-wider">Most Mentioned Keywords</h3>
            <div className="flex flex-wrap gap-2 items-end">
              {parsed.map((kw, i) => {
                const ratio = kw.count / maxCount
                const fontSize = ratio > 0.75 ? 'text-base' : ratio > 0.5 ? 'text-sm' : ratio > 0.25 ? 'text-xs' : 'text-[11px]'
                const padding  = ratio > 0.75 ? 'px-4 py-2' : ratio > 0.5 ? 'px-3 py-1.5' : 'px-2.5 py-1'
                // Color: first third = green (positive keywords), last third = red, middle = purple
                const colorClass = i < Math.floor(parsed.length / 3)
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25'
                  : i >= Math.ceil(parsed.length * 2 / 3)
                  ? 'bg-red-500/15 text-red-300 border-red-500/25 hover:bg-red-500/25'
                  : 'bg-purple-500/15 text-purple-300 border-purple-500/25 hover:bg-purple-500/25'
                return (
                  <span key={kw.word}
                    className={`inline-flex items-center gap-1 rounded-full border font-medium transition-colors cursor-default ${fontSize} ${padding} ${colorClass}`}
                  >
                    {kw.word}
                    <span className="opacity-60 text-[9px] font-normal">×{kw.count}</span>
                  </span>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Category Summary ─────────────────────────────────── */}
      {reviews.length > 0 && (
        <div className="rounded-xl border border-[#1e2d4a] bg-gradient-to-br from-[#0f1629] to-[#0a0f1e] overflow-hidden">

          {/* Header */}
          <div className="px-6 py-4 border-b border-[#1e2d4a] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Review Categories</h3>
              {categories.length > 0 && (
                <p className="text-[11px] text-gray-600 mt-0.5">AI-detected themes · click a tab to explore</p>
              )}
            </div>
            <button
              data-generate-categories
              onClick={generateCategories}
              disabled={catLoading || reviews.length === 0}
              className="min-h-[36px] px-3 py-1.5 text-xs text-purple-400 border border-purple-500/30 hover:bg-purple-500/10 rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5 shrink-0"
            >
              {catLoading ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing…
                </>
              ) : (
                <>✨ {categories.length > 0 ? 'Refresh' : 'Generate'} Categories</>
              )}
            </button>
          </div>

          {catError && (
            <div className="px-6 py-3 bg-red-500/10 border-b border-red-500/20">
              <p className="text-xs text-red-400">⚠ {catError}</p>
            </div>
          )}

          {!catError && categories.length > 0 && categories.every(c => !Array.isArray(c.reviewIndices) || c.reviewIndices.length === 0) && (
            <div className="px-6 py-2.5 bg-amber-500/8 border-b border-amber-500/20 flex items-center justify-between gap-3">
              <p className="text-[11px] text-amber-400/80">Categories need regenerating to show accurate review counts.</p>
              <button
                onClick={() => document.querySelector<HTMLButtonElement>('[data-generate-categories]')?.click()}
                className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2 shrink-0"
              >Refresh now</button>
            </div>
          )}

          {categories.length > 0 ? (() => {
            // Build the exact review list for every category using reviewIndices (the source of truth).
            // Falls back to full text matching only when no indices exist (old cached data).
            const getCatReviews = (cat: Category): Review[] => {
              if (Array.isArray(cat.reviewIndices) && cat.reviewIndices.length > 0) {
                return cat.reviewIndices.map(i => reviews[i]).filter((r): r is Review => r !== undefined)
              }
              // Stale cached categories (no reviewIndices) — show all reviews
              // so the list isn't misleadingly short. User can regenerate to get proper scoping.
              return reviews
            }


            const activeCat = categories.find(c => c.name === activeCategory) ?? null
            const catReviewList: Review[] = activeCat ? getCatReviews(activeCat) : reviews
            const shownCatReviews = catReviewList.slice(0, catVisibleCount)
            const catLabel = activeCat ? activeCat.name : 'All Reviews'

            return (
              <>
                {/* ── Tab strip ── */}
                <div
                  className="flex gap-2 px-4 py-3 overflow-x-auto border-b border-[#1e2d4a]"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#7c3aed #1e2030' }}
                >
                  {/* All Reviews tab */}
                  {(() => {
                    const isActive = !activeCategory
                    return (
                      <button
                        onClick={() => { setActiveCategory(null); setCatVisibleCount(10) }}
                        className={`group flex-shrink-0 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 w-[140px] ${
                          isActive
                            ? 'border-purple-500/50 bg-purple-500/10 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                            : 'border-[#1e2d4a] bg-[#080d1a] hover:border-purple-500/30 hover:bg-[#0d1425]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-base">📋</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wide ${isActive ? 'text-purple-300' : 'text-gray-500'}`}>All</span>
                        </div>
                        <div className={`text-xs font-semibold leading-snug ${isActive ? 'text-purple-100' : 'text-gray-300'}`}>All Reviews</div>
                        <div className={`text-[10px] mt-1 ${isActive ? 'text-purple-400' : 'text-gray-600'}`}>{reviews.length} reviews</div>
                        {/* Quote placeholder — consistent height */}
                        <div className="mt-1.5 h-[28px]" />
                      </button>
                    )
                  })()}

                  {/* Category tabs */}
                  {categories.map(cat => {
                    const cfg    = VERDICT_CONFIG[cat.verdict] ?? VERDICT_CONFIG['Needs Improvement']
                    const isActive = activeCategory === cat.name
                    const scorePercent = Math.round(((cat.sentiment_score + 1) / 2) * 100)
                    const catReviews = getCatReviews(cat)
                    const actualCount = catReviews.length
                    // Pick the first snippet as a one-liner quote
                    const quote = cat.example_snippets?.[0]?.slice(0, 55) ?? ''

                    return (
                      <button
                        key={cat.name}
                        onClick={() => { setActiveCategory(cat.name); setCatVisibleCount(10) }}
                        className={`group flex-shrink-0 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 w-[175px] ${
                          isActive
                            ? 'border-purple-500/50 bg-purple-500/10 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                            : 'border-[#1e2d4a] bg-[#080d1a] hover:border-purple-500/30 hover:bg-[#0d1425]'
                        }`}
                      >
                        {/* Top row: emoji + verdict badge */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-base">{cat.emoji}</span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{cat.verdict}</span>
                        </div>
                        {/* Name */}
                        <div className={`text-xs font-semibold leading-snug line-clamp-1 ${isActive ? 'text-purple-100' : 'text-gray-300'}`}>{cat.name}</div>
                        {/* Count + sentiment bar */}
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-0.5 bg-[#1e2d4a] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                cat.verdict === 'Strength' ? 'bg-emerald-400' :
                                cat.verdict === 'Critical Issue' ? 'bg-red-400' : 'bg-amber-400'
                              }`}
                              style={{ width: `${scorePercent}%` }}
                            />
                          </div>
                          <span className={`text-[10px] shrink-0 ${isActive ? 'text-purple-300' : 'text-gray-500'}`}>{actualCount}</span>
                        </div>
                        {/* One-liner quote */}
                        {quote ? (
                          <p className="mt-1.5 text-[9px] text-gray-600 italic leading-snug line-clamp-2 h-[28px]">
                            "{quote}{quote.length >= 55 ? '…' : ''}"
                          </p>
                        ) : (
                          <div className="mt-1.5 h-[28px]" />
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* ── Review list ── */}
                <div>
                  {/* Count label */}
                  <div className="px-5 py-2.5 flex items-center justify-between border-b border-[#1e2d4a]/50">
                    <p className="text-[11px] text-gray-500">
                      Showing <span className="text-gray-400 font-medium">{Math.min(catVisibleCount, catReviewList.length)}</span> of <span className="text-gray-400 font-medium">{catReviewList.length}</span> review{catReviewList.length !== 1 ? 's' : ''}
                      {activeCat && <span className="text-gray-600"> in {catLabel}</span>}
                    </p>
                    {activeCat && (
                      <button
                        onClick={() => { setActiveCategory(null); setCatVisibleCount(10) }}
                        className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                      >
                        ✕ Clear
                      </button>
                    )}
                  </div>

                  {catReviewList.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                      <p className="text-xs text-gray-500">No reviews in this category.</p>
                    </div>
                  ) : (
                    <>
                      <div className="divide-y divide-[#1e2d4a]/60">
                        {shownCatReviews.map(r => {
                          const hasText      = r.review_text.trim().length > 0
                          const isExpanded   = expandedReviews.has(r.id)
                          const isLong       = hasText && r.review_text.length > 240
                          const displayText  = isLong && !isExpanded ? r.review_text.slice(0, 240) + '…' : r.review_text
                          const dateStr      = relativeDate(r.reviewed_at ?? r.created_at)
                          const needsResponse = r.sentiment === 'negative' && hasText

                          const sentBorder =
                            r.sentiment === 'positive' ? 'border-l-[3px] border-l-emerald-500/70' :
                            r.sentiment === 'negative' ? 'border-l-[3px] border-l-red-500/70' :
                            'border-l-[3px] border-l-gray-600/50'
                          const avatarGrad =
                            r.sentiment === 'positive' ? 'from-emerald-600 to-teal-700' :
                            r.sentiment === 'negative' ? 'from-red-600 to-pink-700' :
                            'from-purple-600 to-blue-600'

                          return (
                            <div
                              key={r.id}
                              className={`px-4 sm:px-5 py-4 flex items-start gap-3 hover:bg-white/[0.018] transition-colors ${sentBorder}`}
                            >
                              {/* Avatar */}
                              <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGrad} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-md mt-0.5`}>
                                {r.reviewer_name[0]?.toUpperCase() ?? '?'}
                              </div>

                              <div className="min-w-0 flex-1">
                                {/* Name + stars + date row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span className="text-sm font-semibold text-gray-100 truncate max-w-[160px]">{r.reviewer_name}</span>
                                    <StarRating rating={r.rating} />
                                  </div>
                                  {dateStr && <span className="text-[10px] text-gray-600 shrink-0">{dateStr}</span>}
                                </div>

                                {/* Review text */}
                                <p className={`text-xs leading-relaxed mt-1.5 ${hasText ? 'text-gray-400' : 'text-gray-600 italic'}`}>
                                  {hasText ? (
                                    <>
                                      {displayText}
                                      {isLong && (
                                        <button
                                          onClick={() => setExpandedReviews(prev => {
                                            const next = new Set(prev)
                                            isExpanded ? next.delete(r.id) : next.add(r.id)
                                            return next
                                          })}
                                          className="ml-1 text-purple-400 hover:text-purple-300 underline"
                                        >
                                          {isExpanded ? 'less' : 'more'}
                                        </button>
                                      )}
                                    </>
                                  ) : 'No written review'}
                                </p>

                                {/* Bottom row: sentiment badge + Respond button */}
                                <div className="flex items-center justify-between mt-2 gap-2">
                                  {r.sentiment && (
                                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                                      r.sentiment === 'positive' ? 'bg-emerald-500/15 text-emerald-400' :
                                      r.sentiment === 'negative' ? 'bg-red-500/15 text-red-400' :
                                      'bg-gray-500/15 text-gray-400'
                                    }`}>
                                      {r.sentiment}
                                    </span>
                                  )}
                                  {needsResponse && (
                                    <button
                                      onClick={() => {
                                        setPendingReviewText(r.review_text)
                                        setPendingNavPage('responder')
                                      }}
                                      className="ml-auto text-[10px] px-2.5 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                                    >
                                      Respond
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Load more — centered outline button */}
                      {catVisibleCount < catReviewList.length && (
                        <div className="px-5 py-4 flex justify-center border-t border-[#1e2d4a]/50">
                          <button
                            onClick={() => setCatVisibleCount(v => v + 10)}
                            className="px-5 py-2 text-xs font-medium text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-500/10 hover:border-purple-500/50 transition-all"
                          >
                            Load 10 more · {catReviewList.length - catVisibleCount} remaining
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )
          })() : !catLoading && (
            <div className="px-6 py-5 text-center">
              <p className="text-xs text-gray-500">
                Click <span className="text-purple-400">✨ Generate Categories</span> to let AI detect themes in your reviews.
              </p>
            </div>
          )}
        </div>
      )}

      {reviews.length === 0 && !loading && (
        <div className="card p-8 text-center">
          <p className="text-3xl mb-3">📝</p>
          <p className="text-sm text-gray-300 font-medium mb-1">No reviews yet</p>
          <p className="text-xs text-gray-500">Reviews fetched from Google will appear here.</p>
        </div>
      )}

    </div>
  )
}
