import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Business, Review } from '../lib/supabase'

// ── Outscraper limits ──────────────────────────────────────────────────────

const MAX_REFRESH_FETCH = 50  // Weekly automatic refresh

// ── Types ──────────────────────────────────────────────────────────────────

type AnalysisResult = {
  sentimentCounts: { positive: number; negative: number; neutral: number }
  reputationScore: number
  topKeywords: string[]
  reviewSentiments: string[]
}

type SentimentPoint = { date: string; positive: number; negative: number }

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
    date: `Batch ${i + 1}`,
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
  const d = new Date(ts)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function isStale(ts: string | null | undefined, days = 7): boolean {
  if (!ts) return true
  return Date.now() - new Date(ts).getTime() > days * 24 * 60 * 60 * 1000
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

// ── Extended Business type with cached fields ──────────────────────────────

type BusinessWithCache = Business & {
  keywords?: string[] | null
  analyzed_at?: string | null
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()
  const [business, setBusiness]               = useState<BusinessWithCache | null>(null)
  const [reviews, setReviews]                 = useState<Review[]>([])
  const [keywords, setKeywords]               = useState<string[]>([])
  const [timeline, setTimeline]               = useState<SentimentPoint[]>([])
  const [loading, setLoading]                 = useState(true)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError]     = useState('')
  const [error, setError]                     = useState('')
  const [fetchingReviews, setFetchingReviews] = useState(false)
  const [fetchError, setFetchError]           = useState('')
  const [fromCache, setFromCache]             = useState(false)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  const loadData = async (forceReanalyze = false) => {
    setLoading(true)
    setError('')
    setAnalysisError('')
    setFromCache(false)
    try {
      const { data: bizData, error: bizErr } = await supabase
        .from('businesses')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (bizErr) throw bizErr
      if (!bizData) return
      setBusiness(bizData)

      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('*')
        .eq('business_id', bizData.id)
        .order('created_at', { ascending: true })
      if (revErr) throw revErr
      const revs: Review[] = revData ?? []
      setReviews(revs)

      if (revs.length === 0) return

      // Split reviews into analyzed vs unanalyzed
      const unanalyzedRevs = revs.filter(r => r.sentiment === null)
      const hasKeywords = Array.isArray(bizData.keywords) && bizData.keywords.length > 0

      if (!forceReanalyze && unanalyzedRevs.length === 0) {
        // ✅ All reviews already have sentiment — load from cache, NO Anthropic call
        console.log('[Dashboard] ✅ All reviews analyzed — loading from cache, NO Anthropic call')
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        setFromCache(true)
      } else if (forceReanalyze) {
        // 🔄 User explicitly clicked Re-analyze — re-run on all reviews
        console.log('[Dashboard] 🌐 Forced re-analyze — calling Anthropic')
        await runAnalysis(revs, bizData.id, revs)
      } else {
        // 🔄 New unanalyzed reviews exist — only analyze those, leave already-analyzed ones alone
        console.log(`[Dashboard] 🌐 ${unanalyzedRevs.length} new unanalyzed reviews — calling Anthropic`)
        await runAnalysis(unanalyzedRevs, bizData.id, revs)
      }
    } catch (e: unknown) {
      console.error('[Dashboard] loadData error:', e)
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  // revsToAnalyze: the reviews we're sending to Anthropic (may be a subset)
  // allRevs: the full review list (to merge results back into)
  const runAnalysis = async (revsToAnalyze: Review[], businessId: string, allRevs: Review[]) => {
    setAnalysisLoading(true)
    setAnalysisError('')
    try {
      const res = await fetch('/api/analyze-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: revsToAnalyze.map(r => r.review_text) }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? `API error ${res.status}`)

      const data: AnalysisResult = payload

      // Build a map of id → new sentiment for the analyzed subset
      const sentimentMap = new Map<string, 'positive' | 'negative' | 'neutral'>()
      revsToAnalyze.forEach((r, i) => {
        sentimentMap.set(r.id, (data.reviewSentiments[i] ?? 'neutral') as 'positive' | 'negative' | 'neutral')
      })

      // Persist sentiments — only update the reviews we analyzed
      for (const r of revsToAnalyze) {
        await supabase
          .from('reviews')
          .update({ sentiment: sentimentMap.get(r.id) })
          .eq('id', r.id)
      }

      // Merge new sentiments back into the full review list
      const mergedRevs: Review[] = allRevs.map(r =>
        sentimentMap.has(r.id) ? { ...r, sentiment: sentimentMap.get(r.id)! } : r
      )

      // Recompute overall stats from the full merged list
      const { score: newScore } = computeStats(mergedRevs)

      // Persist score, keywords, and analyzed_at to businesses table
      const now = new Date().toISOString()
      await supabase
        .from('businesses')
        .update({
          total_reviews:    mergedRevs.length,
          reputation_score: data.reputationScore ?? newScore,
          keywords:         data.topKeywords ?? [],
          analyzed_at:      now,
        })
        .eq('id', businessId)

      setReviews(mergedRevs)
      setKeywords(data.topKeywords ?? [])
      setTimeline(buildTimeline(mergedRevs))

      // Refresh business row to pick up all cached fields
      const { data: refreshed } = await supabase
        .from('businesses').select('*').eq('id', businessId).single()
      if (refreshed) setBusiness(refreshed)

    } catch (e: unknown) {
      console.error('[Dashboard] runAnalysis error:', e)
      setAnalysisError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const fetchNewReviews = async () => {
    if (!business?.place_id) return

    // 7-day staleness guard — skip if fetched less than 7 days ago
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
        // Delete old reviews and insert fresh batch
        await supabase.from('reviews').delete().eq('business_id', business.id)
        const rows = fetched.map((r: {
          reviewer_name: string; review_text: string
          rating: number | null; reviewed_at: string | null
        }) => ({
          business_id:   business.id,
          user_id:       user!.id,
          review_text:   r.review_text,
          reviewer_name: r.reviewer_name,
          rating:        r.rating,
          reviewed_at:   r.reviewed_at,
          sentiment:     null,
        }))
        await supabase.from('reviews').insert(rows)
      }

      // Stamp reviews_fetched_at
      await supabase
        .from('businesses')
        .update({ reviews_fetched_at: new Date().toISOString() })
        .eq('id', business.id)

      // Reload dashboard with fresh data
      await loadData(false)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch reviews')
    } finally {
      setFetchingReviews(false)
    }
  }

  if (loading) {
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
        <button onClick={() => loadData()} className="underline hover:no-underline">Retry</button>
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
              onClick={() => loadData(true)}
              disabled={analysisLoading || fetchingReviews}
              title="Force re-analysis with Anthropic AI"
              className="min-h-[44px] px-3 py-2 text-xs text-purple-400 border border-purple-500/30 hover:bg-purple-500/10 rounded-lg transition-all disabled:opacity-40"
            >
              ✨ Re-analyze
            </button>
          )}
          <button
            onClick={() => loadData(false)}
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
          <button
            onClick={fetchNewReviews}
            className="text-xs text-amber-400 underline hover:no-underline"
          >
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

      {/* Recent reviews */}
      {reviews.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1e2d4a]">
            <h3 className="text-sm font-semibold text-gray-200">Recent Reviews</h3>
          </div>
          <div className="divide-y divide-[#1e2d4a]">
            {[...reviews].reverse().slice(0, 5).map(r => (
              <div key={r.id} className="px-4 sm:px-6 py-3 sm:py-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {r.reviewer_name[0].toUpperCase()}
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
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{r.review_text}</p>
                </div>
              </div>
            ))}
          </div>
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
