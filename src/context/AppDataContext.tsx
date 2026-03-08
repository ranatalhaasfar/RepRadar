import { createContext, useContext, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Business, Review } from '../lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

type Impact   = 'High' | 'Medium' | 'Low'
type Category = 'Service' | 'Food' | 'Pricing' | 'Ambiance' | 'Trending' | 'Opportunity'

export type Insight = {
  id:             number
  icon:           string
  category:       Category
  title:          string
  description:    string
  recommendation: string
  impact:         Impact
}

export type SentimentPoint = { date: string; positive: number; negative: number }

export type BusinessWithCache = Business & {
  keywords?:    string[] | null
  analyzed_at?: string | null
}

type AnalysisResult = {
  sentimentCounts: { positive: number; negative: number; neutral: number }
  reputationScore: number
  topKeywords:     string[]
  reviewSentiments: string[]
}

// ── Helpers (shared with Dashboard) ─────────────────────────────────────────

const MAX_REFRESH_FETCH = 50

export function buildTimeline(reviews: Review[]): SentimentPoint[] {
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

export function computeStats(revs: Review[]) {
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

export function isStale(ts: string | null | undefined, days = 7): boolean {
  if (!ts) return true
  return Date.now() - new Date(ts).getTime() > days * 24 * 60 * 60 * 1000
}

// ── Context value type ───────────────────────────────────────────────────────

type AppDataContextValue = {
  // ── Dashboard state ──
  business:        BusinessWithCache | null
  reviews:         Review[]
  keywords:        string[]
  timeline:        SentimentPoint[]
  dashLoading:     boolean
  analysisLoading: boolean
  analysisError:   string
  dashError:       string
  fetchingReviews: boolean
  fetchError:      string
  dashFromCache:   boolean

  // ── Insights state ──
  insights:          Insight[]
  noReviews:         boolean
  insightsLoading:   boolean
  insightsRefreshing: boolean
  analyzedAt:        string | null
  insightsError:     string
  insightsFromCache: boolean

  // ── Actions ──
  loadDashboard:    (forceReanalyze?: boolean, bypassGuard?: boolean) => Promise<void>
  fetchNewReviews:  () => Promise<void>
  runAnalysis:      (revsToAnalyze: Review[], businessId: string, allRevs: Review[]) => Promise<void>
  setFetchError:    (e: string) => void
  loadInsights:     () => Promise<void>
  refreshInsights:  () => Promise<void>
}

// ── Context ──────────────────────────────────────────────────────────────────

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  // Guard refs — tracks the user.id for which data was last loaded.
  // Using refs (not state) so changes don't cause re-renders.
  const dashLoadedForRef    = useRef<string | null>(null)
  const insightsLoadedForRef = useRef<string | null>(null)

  // ── Dashboard state ──────────────────────────────────────────────────────
  const [business,        setBusiness]        = useState<BusinessWithCache | null>(null)
  const [reviews,         setReviews]         = useState<Review[]>([])
  const [keywords,        setKeywords]        = useState<string[]>([])
  const [timeline,        setTimeline]        = useState<SentimentPoint[]>([])
  const [dashLoading,     setDashLoading]     = useState(true)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError,   setAnalysisError]   = useState('')
  const [dashError,       setDashError]       = useState('')
  const [fetchingReviews, setFetchingReviews] = useState(false)
  const [fetchError,      setFetchError]      = useState('')
  const [dashFromCache,   setDashFromCache]   = useState(false)

  // ── Insights state ───────────────────────────────────────────────────────
  const [insights,           setInsights]           = useState<Insight[]>([])
  const [noReviews,          setNoReviews]          = useState(false)
  const [insightsLoading,    setInsightsLoading]    = useState(true)
  const [insightsRefreshing, setInsightsRefreshing] = useState(false)
  const [analyzedAt,         setAnalyzedAt]         = useState<string | null>(null)
  const [insightsError,      setInsightsError]      = useState('')
  const [insightsFromCache,  setInsightsFromCache]  = useState(false)

  // ── Dashboard actions ────────────────────────────────────────────────────

  const loadDashboard = async (forceReanalyze = false, bypassGuard = false) => {
    if (!user) return

    // Skip if already loaded for this user, unless explicitly bypassing the guard.
    // - forceReanalyze: user clicked "Re-analyze" → bypass guard + call Anthropic
    // - bypassGuard: user clicked "Refresh" → bypass guard, no forced Anthropic call
    // - Neither: initial auto-load → respect guard (no re-fetch on auth token refresh)
    if (!forceReanalyze && !bypassGuard && dashLoadedForRef.current === user.id) return
    dashLoadedForRef.current = user.id

    setDashLoading(true)
    setDashError('')
    setAnalysisError('')
    setDashFromCache(false)
    try {
      const { data: bizData, error: bizErr } = await supabase
        .from('businesses')
        .select('*')
        .eq('user_id', user.id)
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

      const unanalyzedRevs = revs.filter(r => r.sentiment === null)
      const hasKeywords = Array.isArray(bizData.keywords) && bizData.keywords.length > 0

      if (!forceReanalyze && unanalyzedRevs.length === 0) {
        console.log('[AppData] ✅ All reviews analyzed — loading from cache, NO Anthropic call')
        setKeywords(hasKeywords ? bizData.keywords! : [])
        setTimeline(buildTimeline(revs))
        setDashFromCache(true)
      } else if (forceReanalyze) {
        console.log('[AppData] 🌐 Forced re-analyze — calling Anthropic')
        await runAnalysis(revs, bizData.id, revs)
      } else {
        console.log(`[AppData] 🌐 ${unanalyzedRevs.length} new unanalyzed reviews — calling Anthropic`)
        await runAnalysis(unanalyzedRevs, bizData.id, revs)
      }
    } catch (e: unknown) {
      console.error('[AppData] loadDashboard error:', e)
      setDashError(e instanceof Error ? e.message : 'Failed to load data')
      // Reset guard so user can retry
      dashLoadedForRef.current = null
    } finally {
      setDashLoading(false)
    }
  }

  const runAnalysis = async (revsToAnalyze: Review[], businessId: string, allRevs: Review[]) => {
    if (!user) return
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
        await supabase
          .from('reviews')
          .update({ sentiment: sentimentMap.get(r.id) })
          .eq('id', r.id)
      }

      const mergedRevs: Review[] = allRevs.map(r =>
        sentimentMap.has(r.id) ? { ...r, sentiment: sentimentMap.get(r.id)! } : r
      )

      const { score: newScore } = computeStats(mergedRevs)
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

      const { data: refreshed } = await supabase
        .from('businesses').select('*').eq('id', businessId).single()
      if (refreshed) setBusiness(refreshed)

    } catch (e: unknown) {
      console.error('[AppData] runAnalysis error:', e)
      setAnalysisError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const fetchNewReviews = async () => {
    if (!user || !business?.place_id) return

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

      await supabase
        .from('businesses')
        .update({ reviews_fetched_at: new Date().toISOString() })
        .eq('id', business.id)

      // Force a fresh reload (bypass the guard)
      dashLoadedForRef.current = null
      await loadDashboard(false)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch reviews')
    } finally {
      setFetchingReviews(false)
    }
  }

  // ── Insights actions ─────────────────────────────────────────────────────

  const loadInsights = async () => {
    if (!user) return

    // Skip if already loaded for this user
    if (insightsLoadedForRef.current === user.id) return
    insightsLoadedForRef.current = user.id

    setInsightsLoading(true)
    setInsightsError('')
    try {
      const { data: bizData, error: bizErr } = await supabase
        .from('businesses')
        .select('id, name, type')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (bizErr) throw new Error(`Business load error: ${bizErr.message}`)
      if (!bizData) { setInsights([]); return }

      const { data: cached, error: cacheErr } = await supabase
        .from('insights')
        .select('*')
        .eq('business_id', bizData.id)
        .order('created_at', { ascending: false })

      if (cacheErr) {
        console.error('[AppData] Cache read error:', cacheErr.message)
        throw new Error(`Cache error: ${cacheErr.message}. Run the DB migration to create the insights table.`)
      }

      if (cached && cached.length > 0) {
        console.log('[AppData] ✅ Insights loaded from cache — NO Anthropic call')
        setInsights(cached.map((row, i) => ({
          id:             i,
          icon:           row.icon ?? '💡',
          category:       row.category as Category,
          title:          row.title,
          description:    row.description,
          recommendation: row.recommendation,
          impact:         row.impact as Impact,
        })))
        setAnalyzedAt(cached[0].created_at)
        setInsightsFromCache(true)
      } else {
        const { count } = await supabase
          .from('reviews')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bizData.id)
        setNoReviews((count ?? 0) === 0)
        setInsights([])
      }
    } catch (e: unknown) {
      setInsightsError(e instanceof Error ? e.message : 'Failed to load insights')
      // Reset guard so user can retry
      insightsLoadedForRef.current = null
    } finally {
      setInsightsLoading(false)
    }
  }

  const refreshInsights = async () => {
    if (!user) return
    setInsightsRefreshing(true)
    setInsightsError('')
    try {
      const { data: bizData, error: bizErr } = await supabase
        .from('businesses')
        .select('id, name, type')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (bizErr) throw new Error(`Business load error: ${bizErr.message}`)
      if (!bizData) return

      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('review_text')
        .eq('business_id', bizData.id)
      if (revErr) throw new Error(`Reviews load error: ${revErr.message}`)

      const texts = (revData ?? []).map(r => r.review_text)
      if (texts.length === 0) {
        setNoReviews(true)
        setInsights([])
        return
      }

      console.log('[AppData] 🌐 User clicked Refresh Insights — calling Anthropic API')
      const res = await fetch('/api/generate-insights', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ businessName: bizData.name, businessType: bizData.type, reviews: texts }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(errData.error ?? 'Failed to generate insights')
      }
      const data = await res.json()
      const rawInsights: Omit<Insight, 'id'>[] = data.insights ?? []

      await supabase.from('insights').delete().eq('business_id', bizData.id)
      const now = new Date().toISOString()
      const rows = rawInsights.map(ins => ({
        business_id: bizData.id, user_id: user.id,
        icon: ins.icon, category: ins.category, title: ins.title,
        description: ins.description, recommendation: ins.recommendation,
        impact: ins.impact, created_at: now,
      }))
      if (rows.length > 0) {
        const { error: insertErr } = await supabase.from('insights').insert(rows)
        if (insertErr) console.error('[AppData] ❌ insert error:', insertErr.message)
        else console.log('[AppData] ✅ Insights saved —', rows.length, 'rows')
      }

      setInsights(rawInsights.map((ins, i) => ({ ...ins, id: i })))
      setAnalyzedAt(now)
      setInsightsFromCache(false)
      setNoReviews(false)
      // Update guard so next tab switch loads from this context (not DB)
      insightsLoadedForRef.current = user.id
    } catch (e: unknown) {
      setInsightsError(e instanceof Error ? e.message : 'Failed to generate insights')
    } finally {
      setInsightsRefreshing(false)
    }
  }

  // ── Provider ─────────────────────────────────────────────────────────────

  return (
    <AppDataContext.Provider value={{
      business, reviews, keywords, timeline,
      dashLoading, analysisLoading, analysisError, dashError,
      fetchingReviews, fetchError, dashFromCache,
      insights, noReviews, insightsLoading, insightsRefreshing,
      analyzedAt, insightsError, insightsFromCache,
      loadDashboard, fetchNewReviews, runAnalysis, setFetchError,
      loadInsights, refreshInsights,
    }}>
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider')
  return ctx
}
