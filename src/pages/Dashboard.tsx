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
import { StarRating } from '../components/StarRating'
import { DashboardSkeleton } from '../components/Skeletons'
import ReputationGauge from '../components/ReputationGauge'
import { FileText, Smile, Frown, Award, RefreshCw, Download, Lightbulb, Search, AlertCircle } from 'lucide-react'

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
  'Strength':          { bg: 'bg-emerald-50',  border: 'border-emerald-200', badge: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-700' },
  'Needs Improvement': { bg: 'bg-amber-50',    border: 'border-amber-200',   badge: 'bg-amber-50 text-amber-700',   text: 'text-amber-700'   },
  'Critical Issue':    { bg: 'bg-rose-50',     border: 'border-rose-200',    badge: 'bg-rose-50 text-rose-700',     text: 'text-rose-700'    },
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ title, sub, className = '' }: { title: string; sub?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 mb-4 ${className}`}>
      <div className="inline-flex items-center gap-2 bg-white/60 backdrop-blur-sm border border-white/80 rounded-full px-3 py-1 shadow-sm">
        <span className="text-[11px] font-bold text-black/55 tracking-wide">{title}</span>
      </div>
      {sub && <span className="text-[11px] text-black/35">{sub}</span>}
    </div>
  )
}

function StatCard({ icon, value, label, sub, colorClass, barClass, iconBg }: {
  icon: React.ReactNode; value: string | number; label: string; sub?: string
  colorClass: string; barClass: string; iconBg: string
}) {
  return (
    <div className="glass-card p-5 flex items-start gap-4 animate-enter">
      <div className={`w-9 h-9 rounded-[12px] ${iconBg} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className={`font-mono text-[42px] font-bold leading-none mb-1 tracking-tight ${colorClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
        <div className={`${barClass} h-1 w-10 rounded-full mb-1`} />
        <p className="text-[11px] text-black/30 uppercase tracking-[0.08em] font-semibold">{label}</p>
        {sub && <p className="text-[11px] text-black/30 mt-0.5">{sub}</p>}
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
    <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-xl px-3 py-2 text-xs shadow-glass">
      <p className="text-black/40 mb-1 font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">{p.name}: <span>{p.value}%</span></p>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()

  const {
    activeBusiness, activeBusinessId,
    business, reviews, dashboardLoadedAt, dashboardBusinessId, setDashboard,
    categories, categoriesLoadedAt, categoriesBusinessId, setCategories,
    setPendingReviewText, setPendingNavPage, setShowUpgradeModal,
  } = useAppStore()

  const [loading,         setLoading]         = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError,   setAnalysisError]   = useState('')
  const [error,           setError]           = useState('')
  const [fetchingReviews, setFetchingReviews] = useState(false)
  const [fetchError,      setFetchError]      = useState('')
  const [fetchedCount,    setFetchedCount]    = useState<number | null>(null)
  const [fromCache,       setFromCache]       = useState(false)
  const [keywords,        setKeywords]        = useState<string[]>([])
  const [timeline,        setTimeline]        = useState<SentimentPoint[]>([])
  const [initializing,    setInitializing]    = useState(true)

  const [catLoading,      setCatLoading]      = useState(false)
  const [catError,        setCatError]        = useState('')
  const [activeCategory,  setActiveCategory]  = useState<string | null>(null)
  const [catVisibleCount, setCatVisibleCount] = useState(10)

  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set())

  const [catSearch,    setCatSearch]    = useState('')
  const [catSentiment, setCatSentiment] = useState<'all' | 'positive' | 'negative' | 'neutral'>('all')
  const [catDate,      setCatDate]      = useState<'all' | '7d' | '30d' | '3m' | '6m' | '1y'>('all')
  const [catRating,    setCatRating]    = useState<'all' | '5' | '4' | '3' | '12'>('all')
  const [catSort,      setCatSort]      = useState<'newest' | 'oldest' | 'highest' | 'lowest'>('newest')

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

    if (dashboardBusinessId === bizData.id && dashboardLoadedAt !== null && reviews.length > 0) {
      console.log('[Dashboard] Layer 1 hit - Zustand store')
      setKeywords(Array.isArray(bizData.keywords) ? bizData.keywords : [])
      setTimeline(buildTimeline(reviews))
      setFromCache(true)
      setInitializing(false)
      return
    }

    const lsData = lcLoad<{ business: Business; reviews: Review[] }>('reviews', bizData.id)
    if (lsData && Array.isArray(lsData.data?.reviews) && lsData.data.reviews.length > 0) {
      console.log('[Dashboard] Layer 2 hit - localStorage')
      const { business: cachedBiz, reviews: cachedRevs } = lsData.data
      setDashboard(cachedBiz, cachedRevs, bizData.id)
      setKeywords(Array.isArray(cachedBiz.keywords) ? cachedBiz.keywords : [])
      setTimeline(buildTimeline(cachedRevs))
      setFromCache(true)
      setInitializing(false)
      return
    }

    console.log('[Dashboard] Layer 3 - fetching from Supabase')
    setLoading(true)
    try {
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

      if (revs.length === 0) {
        setInitializing(false)
        setLoading(false)
        return
      }

      const unanalyzedRevs = revs.filter(r => r.sentiment === null)
      const hasKeywords = Array.isArray(bizData.keywords) && bizData.keywords.length > 0

      if (unanalyzedRevs.length === 0) {
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        setFromCache(true)
      } else {
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

  const reloadDashboard = async (forceReanalyze = false) => {
    if (!user) return
    setLoading(true)
    setError('')
    setAnalysisError('')
    setFromCache(false)
    try {
      const bizData = activeBusiness
      if (!bizData) return

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
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        setFromCache(true)
      } else if (forceReanalyze) {
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        await runAnalysis(revs, bizData.id, revs)
      } else {
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
      const withText   = revsToAnalyze.filter(r => r.review_text.trim().length > 0)
      const ratingOnly = revsToAnalyze.filter(r => r.review_text.trim().length === 0)

      const starSentiment = (rating: number | null): 'positive' | 'negative' | 'neutral' =>
        rating !== null && rating >= 4 ? 'positive' : rating !== null && rating <= 2 ? 'negative' : 'neutral'

      const sentimentMap = new Map<string, 'positive' | 'negative' | 'neutral'>()

      ratingOnly.forEach(r => sentimentMap.set(r.id, starSentiment(r.rating)))

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
        }
      }

      for (const r of revsToAnalyze) {
        await supabase.from('reviews').update({ sentiment: sentimentMap.get(r.id) }).eq('id', r.id)
      }

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
      setFetchError('Invalid business ID - cannot fetch reviews. Please re-add this business.')
      return
    }

    const isAdminUser = user.email === 'pajamapoems00@gmail.com'
    if (!isAdminUser && !isStale(business.reviews_fetched_at, 7)) {
      setFetchError('Reviews were fetched less than 7 days ago. Please wait before refreshing again.')
      return
    }

    setFetchingReviews(true)
    setFetchError('')
    try {
      const res = await fetch('/api/outscraper-reviews', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ place_id: business.place_id, limit: MAX_REFRESH_FETCH, sort: 'newest', user_id: user?.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        if (d.error === 'upgrade_required') { setShowUpgradeModal(true); return }
        throw new Error(d.error ?? 'Failed to fetch reviews')
      }
      const { reviews: fetched, meta } = await res.json()
      console.log(`[Dashboard] Outscraper returned ${fetched.length} reviews`, meta)
      setFetchedCount(fetched.length)

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
      await reloadDashboard(false)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch reviews')
    } finally {
      setFetchingReviews(false)
    }
  }

  const loadCategories = async () => {
    if (!activeBusiness) return

    if (categoriesBusinessId === activeBusiness.id && categoriesLoadedAt !== null && categories.length > 0) {
      return
    }

    const lsCats = lcLoad<Category[]>('categories', activeBusiness.id)
    if (lsCats && Array.isArray(lsCats.data) && lsCats.data.length > 0) {
      setCategories(lsCats.data, activeBusiness.id)
      return
    }

    setCatError('')
    try {
      const { data, error: dbErr } = await supabase
        .from('categories')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .order('review_count', { ascending: false })
      if (dbErr) throw dbErr
      if (data && data.length > 0) {
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
        body:    JSON.stringify({ reviews, user_id: user?.id }),
      })
      const payload = await res.json()
      if (!res.ok) {
        if (payload.error === 'upgrade_required') { setShowUpgradeModal(true); return }
        throw new Error(payload.error ?? `API error ${res.status}`)
      }

      const newCats: Category[] = payload.categories
      lcClear('categories', activeBusiness.id)
      setCategories(newCats, activeBusiness.id)
      lcSave('categories', activeBusiness.id, newCats)

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
    return <DashboardSkeleton />
  }

  if (error) {
    return (
      <div className="glass-card p-6 text-rose-600 text-sm flex items-center gap-3">
        <AlertCircle size={16} className="flex-shrink-0" />
        <span>{error}</span>
        <button onClick={() => reloadDashboard()} className="underline hover:no-underline text-emerald-600">Retry</button>
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

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-black/80 tracking-tight">
            {business?.name ?? 'Dashboard'}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-black/40 text-sm">{business?.type} - {business?.location}</span>
            {business?.google_rating !== null && business?.google_rating !== undefined && (
              <span className="flex items-center gap-1 text-sm">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="font-semibold text-black/70">{business.google_rating.toFixed(1)}</span>
                <span className="text-black/30 text-xs">Google</span>
              </span>
            )}
            {analysisLoading && (
              <span className="text-emerald-600 animate-pulse text-[11px] font-medium">Analyzing...</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {fromCache && !analysisLoading && (
              <span className="text-[11px] text-emerald-600 font-medium">Loaded from cache</span>
            )}
            {fetchedAt && (
              <p className="text-[11px] text-black/30">{fromCache ? '-' : ''} Last updated: {fetchedAt}</p>
            )}
            {analyzedAt && !analysisLoading && (
              <p className="text-[11px] text-black/30">- Analyzed: {analyzedAt}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {business?.place_id && (
            <button
              onClick={fetchNewReviews}
              disabled={fetchingReviews || analysisLoading}
              title="Fetch latest reviews from Google"
              className="min-h-[40px] px-3 py-2 text-xs text-black/50 border border-black/10 hover:bg-black/[0.03] hover:border-black/20 rounded-xl transition-all disabled:opacity-40 flex items-center gap-1.5 font-medium"
            >
              {fetchingReviews ? (
                <><div className="w-3 h-3 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" /> Fetching...</>
              ) : (
                <>
                  <Download size={14} />
                  Fetch Reviews
                </>
              )}
            </button>
          )}
          {hasAnalysis && (
            <button
              onClick={() => reloadDashboard(true)}
              disabled={analysisLoading || fetchingReviews}
              title="Force re-analysis with Anthropic AI"
              className="min-h-[40px] px-3 py-2 text-xs text-emerald-600 border border-emerald-200 hover:bg-emerald-50 rounded-xl transition-all disabled:opacity-40 font-medium flex items-center gap-1.5"
            >
              <Lightbulb size={14} />
              Re-analyze
            </button>
          )}
          <button
            onClick={() => reloadDashboard(false)}
            disabled={loading || analysisLoading || fetchingReviews}
            className="btn-primary min-h-[40px] px-4 py-2 text-sm flex items-center gap-1.5"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Stale reviews banner ── */}
      {reviewsStale && business?.place_id && !fetchingReviews && (
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
            <span className="text-amber-700 text-xs font-medium">
              {fetchedAt ? 'Reviews are over 7 days old.' : 'Reviews not yet fetched from Google.'}
            </span>
          </div>
          <button onClick={fetchNewReviews} className="text-xs text-amber-600 font-semibold hover:text-amber-500">
            Fetch now
          </button>
        </div>
      )}

      {/* ── Fetch result banner ── */}
      {fetchedCount !== null && !fetchError && (
        <div className={`rounded-xl p-3 flex items-center justify-between gap-3 ${fetchedCount === 0 ? 'bg-rose-50 border border-rose-200' : 'bg-emerald-50 border border-emerald-200'}`}>
          <span className={`text-xs font-medium ${fetchedCount === 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {fetchedCount === 0
              ? 'Outscraper returned 0 reviews - the fetch failed or this business has no reviews yet'
              : <>Fetched <strong>{fetchedCount}</strong> reviews from Google{fetchedCount < 200 && <span className="text-black/30 font-normal"> (reached Outscraper cap)</span>}</>
            }
          </span>
          <button onClick={() => setFetchedCount(null)} className="text-xs text-black/30 hover:text-black/50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Fetch error banner ── */}
      {fetchError && (
        <div className="rounded-xl p-3 bg-rose-50 border border-rose-200 flex items-center gap-3">
          <AlertCircle size={16} className="text-rose-600 flex-shrink-0" />
          <span className="text-rose-700 text-xs font-medium flex-1">{fetchError}</span>
          <button onClick={() => setFetchError('')} className="text-xs text-rose-600 font-semibold hover:text-rose-500">Dismiss</button>
        </div>
      )}

      {/* ── Analysis error banner ── */}
      {analysisError && (
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 flex items-center gap-3">
          <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
          <span className="text-amber-700 text-xs font-medium flex-1">Analysis error: {analysisError}</span>
          <button
            onClick={() => business && runAnalysis(reviews, business.id, reviews)}
            className="text-xs text-amber-600 font-semibold hover:text-amber-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          icon={<FileText size={18} className="text-sky-600" />}
          value={reviews.length}
          label="Total Reviews"
          colorClass="text-[#0284C7]"
          barClass="bg-blue-400/60"
          iconBg="bg-sky-50"
          sub={business?.google_rating ? `${business.google_rating.toFixed(1)} Google rating` : undefined}
        />
        <StatCard
          icon={<Smile size={18} className="text-emerald-600" />}
          value={`${positivePercent}%`}
          label="Positive"
          colorClass="text-[#059669]"
          barClass="bg-emerald-400/60"
          iconBg="bg-emerald-50"
          sub={`${sc.positive} reviews`}
        />
        <StatCard
          icon={<Frown size={18} className="text-rose-600" />}
          value={`${negativePercent}%`}
          label="Negative"
          colorClass="text-[#E11D48]"
          barClass="bg-rose-400/60"
          iconBg="bg-rose-50"
          sub={`${sc.negative} reviews`}
        />
        <StatCard
          icon={<Award size={18} className="text-teal-600" />}
          value={reputationScore}
          label="Reputation Score"
          colorClass="text-[#0F766E]"
          barClass="bg-teal-400/60"
          iconBg="bg-teal-50"
          sub="Out of 100"
        />
      </div>

      {/* ── Action Items ── */}
      {hasAnalysis && (() => {
        const unanswered = reviews.filter(r => r.sentiment === 'negative')
        const weakCat   = categories.find(c => c.verdict === 'Critical Issue')
        const starCat   = categories.find(c => c.verdict === 'Strength')
        const items: { icon: React.ReactNode; colorText: string; bg: string; border: string; title: string; desc: string; action?: string; page?: string; reviewText?: string }[] = []

        if (unanswered.length > 0) {
          items.push({
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>,
            colorText: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200',
            title: `${unanswered.length} negative review${unanswered.length > 1 ? 's' : ''} need a response`,
            desc:  'Responding publicly shows you care and can recover customer trust.',
            action: 'Respond now', page: 'responder', reviewText: unanswered[0]?.review_text,
          })
        }
        if (weakCat) {
          items.push({
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
            colorText: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200',
            title: `"${weakCat.name}" is a critical weakness`,
            desc:  `${weakCat.review_count} reviews mention this area negatively. Address it to boost your score.`,
          })
        }
        if (starCat) {
          items.push({
            icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>,
            colorText: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200',
            title: `Customers love your "${starCat.name}"`,
            desc:  'Highlight this strength in your marketing to attract more customers.',
          })
        }
        if (items.length === 0) return null
        return (
          <div className="glass-card p-5 space-y-3">
            <SectionLabel title="Action Items" />
            {items.map((item, i) => (
              <div key={i} className={`glass-card-inner flex items-start gap-3 px-4 py-3 ${item.bg} border ${item.border}`}>
                <div className={`mt-0.5 shrink-0 ${item.colorText}`}>{item.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${item.colorText}`}>{item.title}</p>
                  <p className="text-xs text-black/45 mt-0.5">{item.desc}</p>
                </div>
                {item.action && item.page && (
                  <button
                    onClick={() => {
                      if (item.reviewText) setPendingReviewText(item.reviewText)
                      setPendingNavPage(item.page as string)
                    }}
                    className="shrink-0 btn-primary text-xs px-3 py-1"
                  >
                    {item.action}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── First-run analysis banner ── */}
      {analysisLoading && !hasAnalysis && (
        <div className="rounded-xl p-4 flex items-center gap-3 bg-emerald-50 border border-emerald-200">
          <div className="w-4 h-4 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-emerald-700 font-medium">Analyzing your reviews with AI... this takes a few seconds.</p>
        </div>
      )}

      {/* ── Gauge + Chart ── */}
      {hasAnalysis && (
        <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-4">
          {/* Overall Score */}
          <div className="glass-card p-6 flex flex-col">
            <div className="mb-2">
              <span className="inline-block text-[11px] font-semibold uppercase tracking-[0.1em] bg-black/[0.04] text-black/40 px-3 py-[5px] rounded-[10px]">
                Overall Score
              </span>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <ReputationGauge score={reputationScore} reviewCount={reviews.length} />
            </div>
          </div>

          {/* Sentiment Trend */}
          <div className="glass-card p-6 flex flex-col">
            <div className="mb-4">
              <span className="inline-block text-[11px] font-semibold uppercase tracking-[0.1em] bg-black/[0.04] text-black/40 px-3 py-[5px] rounded-[10px]">
                Sentiment Trend
              </span>
              <span className="ml-2 text-[11px] text-black/30">Positive vs negative over time</span>
            </div>
            {timeline.length > 1 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={timeline} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'rgba(0,0,0,0.2)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tick={{ fill: 'rgba(0,0,0,0.2)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="positive" name="Positive" stroke="#059669" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#059669' }} />
                  <Line type="monotone" dataKey="negative" name="Negative" stroke="#E11D48" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#E11D48' }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-black/30 text-center py-8">Add more reviews to see a trend chart.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Keywords ── */}
      {keywords.length > 0 && (() => {
        const parsed: KeywordEntry[] = keywords.map((kw, i) => {
          const m = kw.match(/^(.+?)[\s\u00d7x*](\d+)$/)
          return m ? { word: m[1].trim(), count: parseInt(m[2]) } : { word: kw, count: keywords.length - i }
        })
        const maxCount = Math.max(...parsed.map(k => k.count), 1)
        return (
          <div className="glass-card p-6">
            <SectionLabel title="Most Mentioned Keywords" className="mb-4" />

            <div className="flex flex-wrap gap-2 items-end">
              {parsed.map((kw, i) => {
                const ratio = kw.count / maxCount
                const fontSize = ratio > 0.75 ? 'text-sm' : ratio > 0.5 ? 'text-xs' : 'text-[11px]'
                const padding  = ratio > 0.75 ? 'px-3.5 py-1.5' : ratio > 0.5 ? 'px-3 py-1' : 'px-2.5 py-1'
                const colorClass = i < Math.floor(parsed.length / 3)
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : i >= Math.ceil(parsed.length * 2 / 3)
                  ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
                  : 'bg-black/[0.04] text-black/50 border-black/10 hover:bg-black/[0.06]'
                return (
                  <span key={kw.word}
                    className={`inline-flex items-center gap-1 rounded-full border font-medium transition-colors cursor-default ${fontSize} ${padding} ${colorClass}`}
                  >
                    {kw.word}
                    <span className="opacity-60 text-[11px] font-normal">x{kw.count}</span>
                  </span>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Category Summary ── */}
      {reviews.length > 0 && (
        <div className="glass-card overflow-hidden">

          {/* Header */}
          <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between gap-3">
            <div>
              <SectionLabel
                title="Review Categories"
                sub={categories.length > 0 ? 'AI-detected themes · click a tab to explore' : undefined}
              />
            </div>
            <button
              data-generate-categories
              onClick={generateCategories}
              disabled={catLoading || reviews.length === 0}
              className="min-h-[36px] px-3 py-1.5 text-xs text-emerald-600 border border-emerald-200 hover:bg-emerald-50 rounded-xl transition-all disabled:opacity-40 flex items-center gap-1.5 font-medium shrink-0"
            >
              {catLoading ? (
                <><div className="w-3 h-3 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" /> Analyzing...</>
              ) : (
                <>
                  <Lightbulb size={14} />
                  {categories.length > 0 ? 'Refresh' : 'Generate'} Categories
                </>
              )}
            </button>
          </div>

          {catError && (
            <div className="px-6 py-3 bg-rose-50 border-b border-rose-200">
              <p className="text-xs text-rose-700 font-medium">{catError}</p>
            </div>
          )}

          {!catError && categories.length > 0 && categories.every(c => !Array.isArray(c.reviewIndices) || c.reviewIndices.length === 0) && (
            <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
              <p className="text-[11px] text-amber-700 font-medium">Categories need regenerating to show accurate review counts.</p>
              <button
                onClick={() => document.querySelector<HTMLButtonElement>('[data-generate-categories]')?.click()}
                className="text-[11px] text-amber-600 hover:text-amber-500 font-semibold shrink-0"
              >Refresh now</button>
            </div>
          )}

          {categories.length > 0 ? (() => {
            const getCatReviews = (cat: Category): Review[] => {
              if (Array.isArray(cat.reviewIndices) && cat.reviewIndices.length > 0) {
                return cat.reviewIndices.map(i => reviews[i]).filter((r): r is Review => r !== undefined)
              }
              return reviews
            }

            const activeCat = categories.find(c => c.name === activeCategory) ?? null
            const catLabel = activeCat ? activeCat.name : 'All Reviews'

            let catReviewList: Review[] = activeCat ? getCatReviews(activeCat) : reviews

            if (catSentiment !== 'all')
              catReviewList = catReviewList.filter(r => r.sentiment === catSentiment)

            if (catDate !== 'all') {
              const days: Record<string, number> = { '7d': 7, '30d': 30, '3m': 90, '6m': 180, '1y': 365 }
              const cutoff = Date.now() - days[catDate] * 86400000
              catReviewList = catReviewList.filter(r => {
                const d = r.reviewed_at ?? r.created_at
                return d ? new Date(d).getTime() >= cutoff : false
              })
            }

            if (catRating !== 'all')
              catReviewList = catReviewList.filter(r =>
                catRating === '12' ? (r.rating !== null && r.rating <= 2) : r.rating === Number(catRating)
              )

            if (catSearch.trim()) {
              const q = catSearch.toLowerCase()
              catReviewList = catReviewList.filter(r =>
                r.review_text.toLowerCase().includes(q) || r.reviewer_name.toLowerCase().includes(q)
              )
            }

            catReviewList = [...catReviewList].sort((a, b) => {
              if (catSort === 'newest' || catSort === 'oldest') {
                const ta = new Date(a.reviewed_at ?? a.created_at).getTime()
                const tb = new Date(b.reviewed_at ?? b.created_at).getTime()
                return catSort === 'newest' ? tb - ta : ta - tb
              }
              const ra = a.rating ?? 0, rb = b.rating ?? 0
              return catSort === 'highest' ? rb - ra : ra - rb
            })

            const activeFilterCount = [
              catSentiment !== 'all',
              catDate !== 'all',
              catRating !== 'all',
              catSearch.trim() !== '',
            ].filter(Boolean).length

            const clearAllFilters = () => {
              setCatSearch(''); setCatSentiment('all'); setCatDate('all')
              setCatRating('all'); setCatSort('newest'); setCatVisibleCount(10)
            }

            const shownCatReviews = catReviewList.slice(0, catVisibleCount)

            return (
              <>
                {/* ── Tab strip ── */}
                <div className="flex gap-2 px-4 py-3 overflow-x-auto border-b border-black/5 scrollbar-none">
                  {/* All Reviews tab */}
                  {(() => {
                    const isActive = !activeCategory
                    return (
                      <button
                        onClick={() => { setActiveCategory(null); setCatVisibleCount(10); setCatSearch(''); setCatSentiment('all'); setCatDate('all'); setCatRating('all'); setCatSort('newest') }}
                        className={`group flex-shrink-0 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 w-[140px] ${
                          isActive
                            ? 'border-emerald-300 bg-emerald-50 shadow-glass-sm'
                            : 'border-black/[0.07] bg-white/50 hover:border-black/[0.12] hover:bg-white/70'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <svg className="w-4 h-4 text-black/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                          </svg>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-black/40">All</span>
                        </div>
                        <div className="text-xs font-semibold leading-snug text-black/70">All Reviews</div>
                        <div className="text-[11px] mt-1 text-black/40 font-medium">{reviews.length} reviews</div>
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
                    const quote = cat.example_snippets?.[0]?.slice(0, 55) ?? ''

                    return (
                      <button
                        key={cat.name}
                        onClick={() => { setActiveCategory(cat.name); setCatVisibleCount(10); setCatSearch(''); setCatSentiment('all'); setCatDate('all'); setCatRating('all'); setCatSort('newest') }}
                        className={`group flex-shrink-0 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 w-[175px] ${
                          isActive
                            ? `${cfg.border} ${cfg.bg} shadow-glass-sm`
                            : 'border-black/[0.07] bg-white/50 hover:border-black/[0.12] hover:bg-white/70'
                        }`}
                      >
                        {/* Top row: emoji + verdict */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-base">{cat.emoji}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{cat.verdict}</span>
                        </div>
                        {/* Name */}
                        <div className="text-xs font-semibold leading-snug line-clamp-1 text-black/70">{cat.name}</div>
                        {/* Count + sentiment bar */}
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 h-1 bg-black/[0.06] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                cat.verdict === 'Strength' ? 'bg-emerald-400' :
                                cat.verdict === 'Critical Issue' ? 'bg-rose-400' : 'bg-amber-400'
                              }`}
                              style={{ width: `${scorePercent}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-black/40 shrink-0 font-medium">{actualCount}</span>
                        </div>
                        {/* One-liner quote */}
                        {quote ? (
                          <p className="mt-1.5 text-[11px] text-black/35 italic leading-snug line-clamp-2 h-[28px]">
                            &ldquo;{quote}{quote.length >= 55 ? '...' : ''}&rdquo;
                          </p>
                        ) : (
                          <div className="mt-1.5 h-[28px]" />
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* ── Filter bar ── */}
                <div className="px-4 py-2.5 border-b border-black/5 bg-white/30 backdrop-blur-sm flex items-center gap-2 sticky top-0 z-10">
                  {/* Sentiment pills */}
                  <div className="flex gap-1 shrink-0">
                    {([
                      { v: 'all',      label: 'All' },
                      { v: 'positive', label: '+ Pos' },
                      { v: 'negative', label: '- Neg' },
                      { v: 'neutral',  label: '~ Neu' },
                    ] as const).map(({ v, label }) => (
                      <button key={v} onClick={() => { setCatSentiment(v); setCatVisibleCount(10) }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wide transition-all whitespace-nowrap ${
                          catSentiment === v
                            ? v === 'positive' ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                            : v === 'negative' ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
                            : v === 'neutral'  ? 'bg-black/[0.04] text-black/50 ring-1 ring-black/10'
                            : 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                            : 'text-black/35 hover:text-black/50 hover:bg-black/[0.03]'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="w-px h-4 bg-black/10 shrink-0" />

                  {/* Compact dropdowns */}
                  <select value={catDate} onChange={e => { setCatDate(e.target.value as typeof catDate); setCatVisibleCount(10) }}
                    className={`text-[11px] font-medium rounded-lg px-2 py-1 border transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-400/30 ${catDate !== 'all' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white/50 border-black/10 text-black/60 hover:bg-white/70'}`}>
                    <option value="all">All time</option>
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                    <option value="3m">3 months</option>
                    <option value="6m">6 months</option>
                    <option value="1y">1 year</option>
                  </select>

                  <select value={catRating} onChange={e => { setCatRating(e.target.value as typeof catRating); setCatVisibleCount(10) }}
                    className={`text-[11px] font-medium rounded-lg px-2 py-1 border transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-400/30 ${catRating !== 'all' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white/50 border-black/10 text-black/60 hover:bg-white/70'}`}>
                    <option value="all">All stars</option>
                    <option value="5">5 stars</option>
                    <option value="4">4 stars</option>
                    <option value="3">3 stars</option>
                    <option value="12">1-2 stars</option>
                  </select>

                  <select value={catSort} onChange={e => { setCatSort(e.target.value as typeof catSort); setCatVisibleCount(10) }}
                    className={`text-[11px] font-medium rounded-lg px-2 py-1 border transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-400/30 ${catSort !== 'newest' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white/50 border-black/10 text-black/60 hover:bg-white/70'}`}>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="highest">Top rated</option>
                    <option value="lowest">Low rated</option>
                  </select>

                  {/* Search */}
                  <div className="relative flex-1 min-w-0">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-black/25 pointer-events-none" />
                    <input type="text" value={catSearch} onChange={e => { setCatSearch(e.target.value); setCatVisibleCount(10) }}
                      placeholder="Search..."
                      className="w-full bg-white/50 border border-black/10 hover:bg-white/70 text-black/60 text-[11px] rounded-lg pl-6 pr-3 py-1 placeholder-black/25 focus:outline-none focus:ring-1 focus:ring-emerald-400/30 focus:border-emerald-300 transition-all font-medium" />
                  </div>

                  {/* Clear badge */}
                  {activeFilterCount > 0 && (
                    <button onClick={clearAllFilters}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500 text-white text-[11px] font-bold hover:opacity-90 transition-colors shrink-0">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {activeFilterCount}
                    </button>
                  )}
                </div>

                {/* ── Review list ── */}
                <div>
                  {/* Count label */}
                  <div className="px-5 py-2.5 flex items-center justify-between border-b border-black/5">
                    <p className="text-[11px] text-black/35">
                      Showing <span className="text-black/50 font-medium">{Math.min(catVisibleCount, catReviewList.length)}</span> of{' '}
                      <span className="text-black/50 font-medium">{catReviewList.length}</span> review{catReviewList.length !== 1 ? 's' : ''}
                      {activeCat && <span className="text-black/30"> in {catLabel}</span>}
                      {activeFilterCount > 0 && <span className="text-emerald-600"> - {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>}
                    </p>
                    {activeCat && (
                      <button
                        onClick={() => { setActiveCategory(null); setCatVisibleCount(10); clearAllFilters() }}
                        className="text-[11px] text-black/30 hover:text-black/50 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {catReviewList.length === 0 ? (
                    <div className="px-6 py-10 text-center space-y-2">
                      <p className="text-sm text-black/40">{activeFilterCount > 0 ? 'No reviews match your filters.' : 'No reviews in this category.'}</p>
                      {activeFilterCount > 0 && (
                        <button onClick={clearAllFilters} className="text-xs text-emerald-600 hover:text-emerald-500 underline">Clear filters</button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="divide-y divide-black/5">
                        {shownCatReviews.map(r => {
                          const hasText       = r.review_text.trim().length > 0
                          const isExpanded    = expandedReviews.has(r.id)
                          const isLong        = hasText && r.review_text.length > 300
                          const displayText   = isLong && !isExpanded ? r.review_text.slice(0, 300) + '...' : r.review_text
                          const dateStr       = relativeDate(r.reviewed_at ?? r.created_at)
                          const needsResponse = r.sentiment === 'negative' && hasText

                          const sentBorderL =
                            r.sentiment === 'positive' ? 'border-l-[3px] border-l-emerald-400' :
                            r.sentiment === 'negative' ? 'border-l-[3px] border-l-rose-400' :
                            'border-l-[3px] border-l-black/10'
                          const avatarBg =
                            r.sentiment === 'positive' ? 'bg-emerald-100 text-emerald-700' :
                            r.sentiment === 'negative' ? 'bg-rose-100 text-rose-700' :
                            'bg-black/[0.05] text-black/40'

                          return (
                            <div
                              key={r.id}
                              className={`px-4 sm:px-5 py-4 flex items-start gap-3.5 hover:bg-black/[0.015] transition-colors ${sentBorderL}`}
                            >
                              {/* Avatar */}
                              <div className={`w-9 h-9 rounded-[12px] ${avatarBg} flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5`}>
                                {r.reviewer_name[0]?.toUpperCase() ?? '?'}
                              </div>

                              <div className="min-w-0 flex-1">
                                {/* Name + stars + date row */}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span className="text-[14px] font-semibold text-black/75 truncate max-w-[180px]">{r.reviewer_name}</span>
                                    <StarRating rating={r.rating} />
                                  </div>
                                  {dateStr && <span className="text-[11px] text-black/30 shrink-0">{dateStr}</span>}
                                </div>

                                {/* Review text */}
                                <p className={`text-[13px] leading-relaxed mt-1.5 ${hasText ? 'text-black/55' : 'text-black/25 italic'}`}>
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
                                          className="ml-1 text-emerald-600 hover:text-emerald-500 underline text-xs"
                                        >
                                          {isExpanded ? 'less' : 'more'}
                                        </button>
                                      )}
                                    </>
                                  ) : 'No written review'}
                                </p>

                                {/* Bottom row: sentiment badge + Respond button */}
                                <div className="flex items-center justify-between mt-2.5 gap-2">
                                  {r.sentiment && (
                                    <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-[10px] ${
                                      r.sentiment === 'positive' ? 'bg-emerald-50 text-emerald-600' :
                                      r.sentiment === 'negative' ? 'bg-rose-50 text-rose-600' :
                                      'bg-black/[0.04] text-black/40'
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
                                      className="ml-auto btn-primary text-xs px-3 py-1"
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

                      {/* Load more */}
                      {catVisibleCount < catReviewList.length && (
                        <div className="px-5 py-4 flex justify-center border-t border-black/5">
                          <button
                            onClick={() => setCatVisibleCount(v => v + 10)}
                            className="px-5 py-2 text-xs font-medium text-black/45 border border-black/10 rounded-xl hover:bg-black/[0.03] hover:border-black/20 transition-all"
                          >
                            Load 10 more - {catReviewList.length - catVisibleCount} remaining
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )
          })() : !catLoading && (
            <div className="px-6 py-6 text-center">
              <p className="text-xs text-black/30">
                Click <span className="text-emerald-600 font-semibold">Generate Categories</span> to let AI detect themes in your reviews.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {reviews.length === 0 && !loading && (
        <div className="glass-card p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <FileText size={24} className="text-emerald-500" />
          </div>
          <p className="text-sm text-black/50 font-semibold mb-1">No reviews yet</p>
          <p className="text-xs text-black/30">Reviews fetched from Google will appear here.</p>
        </div>
      )}

    </div>
  )
}
