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

const MAX_REFRESH_FETCH = 50

// ── Types ──────────────────────────────────────────────────────────────────

type AnalysisResult = {
  sentimentCounts: { positive: number; negative: number; neutral: number }
  reputationScore: number
  topKeywords:     string[]
  reviewSentiments: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildTimeline(reviews: Review[]): SentimentPoint[] {
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
    date:     `Batch ${i + 1}`,
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

function StatCard({ icon, value, label, sub, color = 'text-gray-100' }: {
  icon: string; value: string | number; label: string; sub?: string; color?: string
}) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <span className="text-2xl mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className={`text-2xl font-bold ${color} leading-none mb-0.5`}>{value}</p>
        <p className="text-xs font-medium text-gray-400">{label}</p>
        {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function ReputationGauge({ score }: { score: number }) {
  const r = 64, cx = 80, cy = 80
  const circumference = 2 * Math.PI * r
  const arc = circumference * 0.75
  const offset = arc - (arc * score) / 100
  const color = score >= 75 ? '#a855f7' : score >= 50 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <svg width="140" height="140" viewBox="0 0 160 160" className="-rotate-[135deg] w-32 h-32 sm:w-40 sm:h-40">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2d4a" strokeWidth="12"
          strokeDasharray={`${arc} ${circumference - arc}`} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={`${arc - offset} ${circumference}`} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="-mt-10 sm:-mt-12 text-center">
        <p className="text-3xl sm:text-4xl font-bold text-gray-100">{score}</p>
        <p className="text-xs text-gray-500">/ 100</p>
        <p className="text-[11px] text-gray-500 mt-1">Reputation Score</p>
      </div>
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
        <span key={i} className={`text-xs ${i <= rating ? 'text-yellow-400' : 'text-gray-700'}`}>★</span>
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

  // ── Review filter state ──
  const [filterTime,      setFilterTime]      = useState<'all' | 'week' | 'month' | 'older'>('all')
  const [filterSentiment, setFilterSentiment] = useState<'all' | 'positive' | 'negative' | 'neutral'>('all')
  const [filterSort,      setFilterSort]      = useState<'newest' | 'lowest' | 'highest'>('newest')
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
      const res = await fetch('/api/analyze-reviews', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reviews: revsToAnalyze.map(r => r.review_text) }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? `API error ${res.status}`)

      const data: AnalysisResult = payload

      const sentimentMap = new Map<string, 'positive' | 'negative' | 'neutral'>()
      revsToAnalyze.forEach((r, i) => {
        sentimentMap.set(r.id, (data.reviewSentiments[i] ?? 'neutral') as 'positive' | 'negative' | 'neutral')
      })

      for (const r of revsToAnalyze) {
        await supabase.from('reviews').update({ sentiment: sentimentMap.get(r.id) }).eq('id', r.id)
      }

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

      // Refresh business row and update store + localStorage
      const { data: refreshed } = await supabase.from('businesses').select('*').eq('id', businessId).single()
      if (refreshed) {
        setDashboard(refreshed as Business, mergedRevs, businessId)
        lcSave('reviews', businessId, { business: refreshed as Business, reviews: mergedRevs })
        console.log('[Dashboard] ✅ Analysis complete — saved to localStorage')
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
        setCategories(data as Category[], activeBusiness.id)
        lcSave('categories', activeBusiness.id, data as Category[])
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
      }))
      await supabase.from('categories').insert(rows)
    } catch (e: unknown) {
      setCatError(e instanceof Error ? e.message : 'Category generation failed')
    } finally {
      setCatLoading(false)
    }
  }

  // ── Computed filtered reviews ─────────────────────────────────────────

  const filteredReviews = (() => {
    let list = [...reviews]

    // Category filter
    if (activeCategory) {
      const cat = categories.find(c => c.name === activeCategory)
      if (cat) {
        list = list.filter(r => {
          const text = r.review_text.toLowerCase()
          const catLower = cat.name.toLowerCase()
          const snippetMatch = cat.example_snippets.some(s => text.includes(s.slice(0, 20).toLowerCase()))
          return text.includes(catLower) || snippetMatch
        })
      }
    }

    // Time filter
    const now = Date.now()
    if (filterTime === 'week') {
      list = list.filter(r => {
        const ts = r.reviewed_at ?? r.created_at
        return now - new Date(ts).getTime() <= 7 * 86_400_000
      })
    } else if (filterTime === 'month') {
      list = list.filter(r => {
        const ts = r.reviewed_at ?? r.created_at
        return now - new Date(ts).getTime() <= 30 * 86_400_000
      })
    } else if (filterTime === 'older') {
      list = list.filter(r => {
        const ts = r.reviewed_at ?? r.created_at
        return now - new Date(ts).getTime() > 30 * 86_400_000
      })
    }

    // Sentiment filter
    if (filterSentiment !== 'all') {
      list = list.filter(r => r.sentiment === filterSentiment)
    }

    // Sort
    if (filterSort === 'newest') {
      list.sort((a, b) => {
        const ta = new Date(a.reviewed_at ?? a.created_at).getTime()
        const tb = new Date(b.reviewed_at ?? b.created_at).getTime()
        return tb - ta
      })
    } else if (filterSort === 'lowest') {
      list.sort((a, b) => (a.rating ?? 3) - (b.rating ?? 3))
    } else if (filterSort === 'highest') {
      list.sort((a, b) => (b.rating ?? 3) - (a.rating ?? 3))
    }

    return list
  })()

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
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-100">
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
          label="Total Reviews"
          sub={business?.google_rating ? `${business.google_rating.toFixed(1)}★ Google rating` : undefined}
        />
        <StatCard icon="😊" value={`${positivePercent}%`}   label="Positive"         color="text-emerald-400" sub={`${sc.positive} reviews`} />
        <StatCard icon="😞" value={`${negativePercent}%`}   label="Negative"         color="text-red-400"     sub={`${sc.negative} reviews`} />
        <StatCard icon="🏆" value={reputationScore}          label="Reputation Score" color="text-purple-400"  sub="Out of 100" />
      </div>

      {/* Gauge + Chart */}
      {hasAnalysis && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-gray-200 mb-1">Overall Score</h3>
            <p className="text-xs text-gray-500 mb-4">Calculated from {reviews.length} reviews</p>
            <ReputationGauge score={reputationScore} />
          </div>
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-gray-200 mb-1">Sentiment Trend</h3>
            <p className="text-xs text-gray-500 mb-4">Positive vs negative across your reviews</p>
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
      {keywords.length > 0 && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Most Mentioned Keywords</h3>
          <div className="flex flex-wrap gap-2">
            {keywords.map(kw => (
              <span key={kw} className="badge bg-purple-500/15 text-purple-300 border border-purple-500/20 text-xs px-3 py-1">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Category Summary ─────────────────────────────────── */}
      {reviews.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1e2d4a] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">Review Categories</h3>
              {categories.length > 0 && (
                <p className="text-[11px] text-gray-600 mt-0.5">AI-detected themes from your reviews · click to filter</p>
              )}
            </div>
            <button
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

          {categories.length > 0 ? (
            <div className="p-4 flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
              {/* "All" reset chip */}
              <button
                onClick={() => setActiveCategory(null)}
                className={`shrink-0 flex flex-col gap-1 p-3 rounded-xl border text-left transition-all min-w-[120px] max-w-[160px] ${
                  activeCategory === null
                    ? 'bg-purple-500/20 border-purple-500/40'
                    : 'bg-white/5 border-[#1e2d4a] hover:border-purple-500/30'
                }`}
              >
                <span className="text-lg">🗂</span>
                <span className="text-xs font-semibold text-gray-200 leading-tight">All Reviews</span>
                <span className="text-[10px] text-gray-500">{reviews.length} total</span>
              </button>

              {categories.map(cat => {
                const cfg = VERDICT_CONFIG[cat.verdict] ?? VERDICT_CONFIG['Needs Improvement']
                const isActive = activeCategory === cat.name
                const scorePercent = Math.round(((cat.sentiment_score + 1) / 2) * 100)
                return (
                  <button
                    key={cat.name}
                    onClick={() => setActiveCategory(isActive ? null : cat.name)}
                    className={`shrink-0 flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all min-w-[140px] max-w-[180px] ${
                      isActive
                        ? `${cfg.bg} ${cfg.border} ring-1 ring-inset ${cfg.border}`
                        : `${cfg.bg} ${cfg.border} hover:ring-1 hover:ring-inset hover:${cfg.border}`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-xl">{cat.emoji}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                        {cat.verdict}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-gray-200 leading-tight">{cat.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-[#1e2d4a] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            cat.verdict === 'Strength' ? 'bg-emerald-400' :
                            cat.verdict === 'Critical Issue' ? 'bg-red-400' : 'bg-amber-400'
                          }`}
                          style={{ width: `${scorePercent}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-gray-500 shrink-0">{cat.review_count} reviews</span>
                    </div>
                    {cat.example_snippets[0] && (
                      <p className="text-[10px] text-gray-500 leading-tight line-clamp-2 italic">
                        "{cat.example_snippets[0]}"
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          ) : !catLoading && (
            <div className="px-6 py-5 text-center">
              <p className="text-xs text-gray-500">
                Click <span className="text-purple-400">✨ Generate Categories</span> to let AI detect themes in your reviews.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Reviews List ────────────────────────────────────── */}
      {reviews.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1e2d4a] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">
                Reviews
                {activeCategory && (
                  <span className="ml-2 text-[11px] text-purple-400 font-normal">· {activeCategory}</span>
                )}
              </h3>
              <p className="text-[11px] text-gray-600 mt-0.5">{filteredReviews.length} of {reviews.length} shown</p>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Time filter */}
              <select
                value={filterTime}
                onChange={e => setFilterTime(e.target.value as typeof filterTime)}
                className="text-xs bg-[#0f1629] border border-[#1e2d4a] text-gray-300 rounded-lg px-2 py-1.5 min-h-[34px] focus:outline-none focus:border-purple-500/50"
              >
                <option value="all">All time</option>
                <option value="week">Past week</option>
                <option value="month">Past month</option>
                <option value="older">Older</option>
              </select>

              {/* Sentiment filter */}
              <select
                value={filterSentiment}
                onChange={e => setFilterSentiment(e.target.value as typeof filterSentiment)}
                className="text-xs bg-[#0f1629] border border-[#1e2d4a] text-gray-300 rounded-lg px-2 py-1.5 min-h-[34px] focus:outline-none focus:border-purple-500/50"
              >
                <option value="all">All sentiment</option>
                <option value="positive">Positive</option>
                <option value="negative">Negative</option>
                <option value="neutral">Neutral</option>
              </select>

              {/* Sort */}
              <select
                value={filterSort}
                onChange={e => setFilterSort(e.target.value as typeof filterSort)}
                className="text-xs bg-[#0f1629] border border-[#1e2d4a] text-gray-300 rounded-lg px-2 py-1.5 min-h-[34px] focus:outline-none focus:border-purple-500/50"
              >
                <option value="newest">Newest first</option>
                <option value="highest">Highest rating</option>
                <option value="lowest">Lowest rating</option>
              </select>
            </div>
          </div>

          {filteredReviews.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-xs text-gray-500">No reviews match the current filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#1e2d4a]">
              {filteredReviews.map(r => {
                const isExpanded = expandedReviews.has(r.id)
                const isLong = r.review_text.length > 200
                const displayText = isLong && !isExpanded
                  ? r.review_text.slice(0, 200) + '…'
                  : r.review_text
                const dateStr = relativeDate(r.reviewed_at ?? r.created_at)

                return (
                  <div key={r.id} className="px-4 sm:px-6 py-3 sm:py-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {r.reviewer_name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-gray-200">{r.reviewer_name}</span>
                        <StarRating rating={r.rating} />
                        {r.sentiment && (
                          <span className={`badge text-[10px] ${
                            r.sentiment === 'positive' ? 'bg-emerald-500/15 text-emerald-400' :
                            r.sentiment === 'negative' ? 'bg-red-500/15 text-red-400' :
                            'bg-gray-500/15 text-gray-400'
                          }`}>
                            {r.sentiment}
                          </span>
                        )}
                        {dateStr && (
                          <span className="text-[10px] text-gray-600">{dateStr}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">
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
                      </p>
                      {r.rating !== null && r.rating <= 3 && (
                        <button
                          onClick={() => {
                            setPendingReviewText(r.review_text)
                            setPendingNavPage('responder')
                          }}
                          className="mt-1.5 text-[10px] text-purple-400 hover:text-purple-300 border border-purple-500/25 hover:border-purple-500/50 px-2 py-0.5 rounded-md transition-all"
                        >
                          ✍ Respond
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
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
