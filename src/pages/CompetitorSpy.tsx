import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAppStore } from '../store/appStore'

// ── Types ──────────────────────────────────────────────────────────────────

type FetchedReview = {
  review_text:   string
  rating:        number | null
  reviewer_name: string | null
  reviewed_at:   string | null
}

type CompetitorEntry = {
  id:            string
  name:          string
  location:      string
  place_id:      string | null
  full_address:  string | null
  google_rating: number | null
  total_reviews: number | null
  reviews_fetched_at: string | null
  fetched_count?: number  // Actual count in our DB
  _reviews?: FetchedReview[]  // Temp: holds raw reviews before DB save
}

type CompetitorInsights = {
  review_velocity:       string
  biggest_weakness:      string
  your_advantages:       string[]
  rating_trend:          string
  steal_their_customers: string
}

type InsightState = {
  data:         CompetitorInsights | null
  loading:      boolean
  error:        string
  generated_at: string | null
  cached:       boolean
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StarBar({ rating }: { rating: number }) {
  const pct = (rating / 5) * 100
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#1e2d4a] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-amber-400 w-8 text-right font-medium">{rating.toFixed(1)}★</span>
    </div>
  )
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { fill: string; name: string; value: number }[]; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-300 font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.fill }}>
          {p.name}: <span className="font-bold">{p.value}★</span>
        </p>
      ))}
    </div>
  )
}

function SpinnerIcon({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function InsightSection({
  competitorId,
  competitor,
  insightState,
  onRefresh,
}: {
  competitorId: string
  competitor: CompetitorEntry
  insightState: InsightState
  onRefresh: (competitorId: string) => void
}) {
  const { data, loading, error } = insightState

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔍</span>
          <div>
            <h4 className="text-sm font-semibold text-gray-200">{competitor.name}</h4>
            <p className="text-xs text-gray-500">Competitive Intelligence</p>
          </div>
        </div>
        <button
          onClick={() => onRefresh(competitorId)}
          disabled={loading}
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          {loading ? <SpinnerIcon size={3} /> : '↻'} Refresh Insights
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {loading && !data && (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
          <SpinnerIcon size={3} /> Analyzing competitor reviews…
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Review Velocity */}
          <div className="bg-[#080d1a] rounded-lg p-3 border border-[#1e2d4a]">
            <p className="text-xs font-medium text-blue-400 mb-1.5">📈 Review Velocity</p>
            <p className="text-xs text-gray-400 leading-relaxed">{data.review_velocity}</p>
          </div>

          {/* Rating Trend */}
          <div className="bg-[#080d1a] rounded-lg p-3 border border-[#1e2d4a]">
            <p className="text-xs font-medium text-amber-400 mb-1.5">📊 Rating Trend</p>
            <p className="text-xs text-gray-400 leading-relaxed">{data.rating_trend}</p>
          </div>

          {/* Their Biggest Weakness */}
          <div className="bg-[#080d1a] rounded-lg p-3 border border-[#1e2d4a]">
            <p className="text-xs font-medium text-red-400 mb-1.5">⚠️ Their Biggest Weakness</p>
            <p className="text-xs text-gray-400 leading-relaxed">{data.biggest_weakness}</p>
          </div>

          {/* Your Advantages */}
          <div className="bg-[#080d1a] rounded-lg p-3 border border-[#1e2d4a]">
            <p className="text-xs font-medium text-emerald-400 mb-1.5">✅ Your Advantages</p>
            <ul className="space-y-1">
              {(data.your_advantages ?? []).map((adv, i) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                  <span className="text-emerald-500 shrink-0 mt-0.5">›</span>
                  {adv}
                </li>
              ))}
            </ul>
          </div>

          {/* Steal Their Customers — full width */}
          <div className="sm:col-span-2 bg-purple-500/10 rounded-lg p-3 border border-purple-500/20">
            <p className="text-xs font-medium text-purple-400 mb-1.5">🎯 Steal Their Customers</p>
            <p className="text-xs text-gray-300 leading-relaxed">{data.steal_their_customers}</p>
          </div>
        </div>
      )}

      {insightState.generated_at && (
        <p className="text-xs text-gray-600">
          {insightState.cached ? '🗄 Cached · ' : '✨ Just generated · '}
          {new Date(insightState.generated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CompetitorSpy() {
  const { user } = useAuth()
  const activeBusiness = useAppStore(s => s.activeBusiness)
  const [myReviewTexts, setMyReviewTexts] = useState<string[]>([])

  // Inputs: name + city pairs
  const [inputs, setInputs] = useState([
    { name: '', city: '' },
    { name: '', city: '' },
    { name: '', city: '' },
  ])

  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([])
  const [isLoading, setIsLoading]     = useState(false)
  const [loadingMsg, setLoadingMsg]   = useState('')
  const [error, setError]             = useState('')
  const [hasResults, setHasResults]   = useState(false)

  // Per-competitor insight state: competitorId → InsightState
  const [insightStates, setInsightStates] = useState<Record<string, InsightState>>({})

  // ── Load cached competitors and insights ─────────────────────────────────

  const loadCachedData = async (biz: typeof activeBusiness) => {
    if (!biz) return

    // Load my reviews
    const { data: revs } = await supabase
      .from('reviews')
      .select('review_text')
      .eq('business_id', biz.id)
    setMyReviewTexts((revs ?? []).map(r => r.review_text))

    // Load cached competitors
    const { data: comps } = await supabase
      .from('competitors')
      .select('*')
      .eq('business_id', biz.id)
      .order('created_at', { ascending: true })

    if (comps && comps.length > 0) {
      // Fetch DB review counts for each competitor
      const withCounts = await Promise.all(comps.map(async c => {
        const { count } = await supabase
          .from('competitor_reviews')
          .select('id', { count: 'exact', head: true })
          .eq('competitor_id', c.id)
        return { ...c, fetched_count: count ?? 0 }
      }))

      setCompetitors(withCounts)
      setHasResults(true)
      setInputs(
        comps.slice(0, 3).map(c => ({ name: c.name, city: c.location ?? '' })).concat(
          Array(Math.max(0, 3 - comps.length)).fill({ name: '', city: '' })
        ).slice(0, 3)
      )

      // Load cached insights for each competitor
      const ids = withCounts.filter(c => c.id).map(c => c.id)
      const newStates: Record<string, InsightState> = {}
      if (ids.length > 0) {
        const { data: cachedInsights } = await supabase
          .from('competitor_analysis')
          .select('*')
          .eq('business_id', biz.id)
          .in('competitor_id', ids)
        if (cachedInsights && cachedInsights.length > 0) {
          cachedInsights.forEach(row => {
            newStates[row.competitor_id] = {
              data:         row.insights,
              loading:      false,
              error:        '',
              generated_at: row.generated_at,
              cached:       true,
            }
          })
        }
      }
      setInsightStates(newStates)
      // Return competitors with reviews but no cached insights — caller will auto-generate
      return withCounts.filter(c => (c.fetched_count ?? 0) > 0 && !newStates[c.id])
    } else {
      setCompetitors([])
      setHasResults(false)
      setInputs([{ name: '', city: '' }, { name: '', city: '' }, { name: '', city: '' }])
    }
    return []
  }

  useEffect(() => {
    if (!user || !activeBusiness) return
    loadCachedData(activeBusiness).then(needsInsights => {
      needsInsights?.forEach(comp => fetchInsights(comp, false))
    })
  }, [user, activeBusiness?.id])

  // ── Refresh button: reload counts + insights without re-fetching Outscraper ──

  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefreshData = async () => {
    if (!activeBusiness) return
    setIsRefreshing(true)
    setInsightStates({})
    const needsInsights = await loadCachedData(activeBusiness)
    needsInsights?.forEach(comp => fetchInsights(comp, false))
    setIsRefreshing(false)
  }

  const updateInput = (i: number, field: 'name' | 'city', val: string) => {
    setInputs(prev => { const next = [...prev]; next[i] = { ...next[i], [field]: val }; return next })
  }

  // ── Fetch insights for a single competitor ───────────────────────────────

  const fetchInsights = async (comp: CompetitorEntry, refresh = false) => {
    if (!activeBusiness || !comp.id) return

    setInsightStates(prev => ({
      ...prev,
      [comp.id]: { data: prev[comp.id]?.data ?? null, loading: true, error: '', generated_at: prev[comp.id]?.generated_at ?? null, cached: false },
    }))

    try {
      // Fetch competitor review texts from competitor_reviews table
      const { data: compRevs } = await supabase
        .from('competitor_reviews')
        .select('review_text')
        .eq('competitor_id', comp.id)
        .limit(30)
      const competitorReviews = (compRevs ?? []).map(r => r.review_text)

      const res = await fetch('/api/competitor-insights', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          business_id:       activeBusiness.id,
          competitor_id:     comp.id,
          businessName:      activeBusiness.name,
          businessType:      activeBusiness.type,
          myRating:          activeBusiness.google_rating,
          competitorName:    comp.name,
          competitorRating:  comp.google_rating,
          competitorReviews,
          myReviews:         myReviewTexts.slice(0, 15),
          refresh,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to generate insights')
      }

      const { insights, cached, generated_at } = await res.json()
      setInsightStates(prev => ({
        ...prev,
        [comp.id]: { data: insights, loading: false, error: '', generated_at, cached },
      }))
    } catch (e: unknown) {
      setInsightStates(prev => ({
        ...prev,
        [comp.id]: {
          data:         prev[comp.id]?.data ?? null,
          loading:      false,
          error:        e instanceof Error ? e.message : 'Failed to generate insights',
          generated_at: prev[comp.id]?.generated_at ?? null,
          cached:       false,
        },
      }))
    }
  }

  const handleRefreshInsights = (competitorId: string) => {
    const comp = competitors.find(c => c.id === competitorId)
    if (comp) fetchInsights(comp, true)
  }

  // ── Run competitor spy ───────────────────────────────────────────────────

  const runSpy = async () => {
    const entries = inputs.filter(v => v.name.trim())
    if (entries.length === 0) { setError('Enter at least one competitor name.'); return }

    setError('')
    setIsLoading(true)
    setHasResults(false)
    setInsightStates({})

    try {
      const results: CompetitorEntry[] = []

      for (const entry of entries) {
        const compName = entry.name.trim()
        const compCity = entry.city.trim() || activeBusiness?.location || ''

        // 1. Search Google Maps
        setLoadingMsg(`Searching Google Maps for "${compName}"…`)
        const qs = new URLSearchParams({ name: compName, city: compCity })
        const searchRes  = await fetch(`/api/outscraper-search?${qs}`)
        const searchData = await searchRes.json()

        if (!searchRes.ok || !searchData.found) {
          results.push({
            id: '', name: compName, location: compCity,
            place_id: null, full_address: null,
            google_rating: null, total_reviews: null,
            reviews_fetched_at: null, fetched_count: 0,
          })
          continue
        }

        // 2. Fetch 50 most-recent reviews for this competitor
        let fetchedReviews: { review_text: string; rating: number | null; reviewer_name: string | null; reviewed_at: string | null }[] = []
        if (typeof searchData.place_id === 'string' && searchData.place_id.startsWith('ChIJ')) {
          setLoadingMsg(`Fetching reviews for "${searchData.name}"… (may take 1–2 min)`)
          console.log('OUTSCRAPER CALL — competitor place_id:', searchData.place_id)
          const revRes = await fetch('/api/outscraper-reviews', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ place_id: searchData.place_id, competitor: true }),
          })
          if (revRes.ok) {
            const revData = await revRes.json()
            fetchedReviews = revData.reviews ?? []
          }
        } else {
          console.error('BLOCKED competitor review fetch — invalid place_id:', searchData.place_id)
        }

        results.push({
          id: '', name: searchData.name, location: compCity,
          place_id:      searchData.place_id,
          full_address:  searchData.full_address,
          google_rating: searchData.rating,
          total_reviews: searchData.reviews_count,
          reviews_fetched_at: new Date().toISOString(),
          fetched_count: fetchedReviews.length,
          _reviews: fetchedReviews,
        })
      }

      // 3. Save competitors to DB, then save their reviews under the real UUID
      if (activeBusiness) {
        setLoadingMsg('Saving competitor data…')
        await supabase.from('competitors').delete().eq('business_id', activeBusiness.id)
        const rows = results.map(r => ({
          business_id:        activeBusiness.id,
          name:               r.name,
          location:           r.location,
          place_id:           r.place_id,
          full_address:       r.full_address,
          google_rating:      r.google_rating,
          total_reviews:      r.total_reviews,
          reviews_fetched_at: r.reviews_fetched_at,
        }))
        const { data: saved } = await supabase.from('competitors').insert(rows).select()
        if (saved) {
          results.forEach((r, i) => { r.id = saved[i]?.id ?? '' })
        }

        // Save competitor reviews to competitor_reviews table (separate from reviews
        // to avoid FK constraint — reviews.business_id → businesses.id would reject
        // competitor UUIDs which don't exist in the businesses table)
        for (const r of results) {
          const reviewsToSave: FetchedReview[] = r._reviews ?? []
          if (!r.id || reviewsToSave.length === 0) continue

          setLoadingMsg(`Saving reviews for "${r.name}"…`)
          await supabase.from('competitor_reviews').delete().eq('competitor_id', r.id)

          const reviewRows = reviewsToSave.map((rev: FetchedReview) => ({
            competitor_id: r.id,
            business_id:   activeBusiness.id,
            review_text:   rev.review_text ?? '',
            rating:        rev.rating ?? null,
            reviewer_name: rev.reviewer_name ?? null,
            reviewed_at:   rev.reviewed_at ?? null,
            sentiment:     rev.rating != null ? (rev.rating >= 4 ? 'positive' : rev.rating <= 2 ? 'negative' : 'neutral') : null,
          }))

          const { error: revInsertErr } = await supabase.from('competitor_reviews').insert(reviewRows)
          if (revInsertErr) {
            console.error(`Failed to save reviews for ${r.name}:`, revInsertErr.message)
            setError(`Could not save reviews for ${r.name}: ${revInsertErr.message}`)
          } else {
            console.log(`Saved ${reviewRows.length} reviews for competitor ${r.name} (id: ${r.id})`)
            r.fetched_count = reviewRows.length
          }
        }
      }

      setCompetitors(results)
      setHasResults(true)

      // 4. Auto-generate insights for competitors that have reviews
      for (const comp of results) {
        if (comp.id && (comp.fetched_count ?? 0) > 0) {
          fetchInsights(comp, false)
        }
      }

    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch competitor data')
    } finally {
      setIsLoading(false)
      setLoadingMsg('')
    }
  }

  // ── Chart data ───────────────────────────────────────────────────────────

  const chartData = [
    { name: 'You', rating: activeBusiness?.google_rating ?? 0, fill: '#a855f7' },
    ...competitors
      .filter(c => c.google_rating !== null)
      .map((c, idx) => ({
        name:   c.name.split(' ').slice(0, 2).join(' '),
        rating: c.google_rating!,
        fill:   ['#3b82f6', '#06b6d4', '#8b5cf6'][idx % 3],
      })),
  ].filter(d => d.rating > 0)

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-100">Competitor Spy</h1>
          <p className="text-gray-500 text-sm mt-1">
            Fetch real Google reviews from competitors and compare with AI.
          </p>
        </div>
        <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-3 py-1 self-start">
          🌐 Live Data
        </span>
      </div>

      {/* Input card */}
      <div className="card p-4 sm:p-6">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">
          Enter Competitor Names
        </p>
        <div className="space-y-3 mb-4">
          {inputs.map((val, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={val.name}
                onChange={e => updateInput(i, 'name', e.target.value)}
                placeholder={`Competitor ${i + 1} name`}
                className="input-dark text-sm"
                onKeyDown={e => e.key === 'Enter' && runSpy()}
              />
              <input
                value={val.city}
                onChange={e => updateInput(i, 'city', e.target.value)}
                placeholder={`City (optional, defaults to ${activeBusiness?.location ?? 'your city'})`}
                className="input-dark text-sm"
                onKeyDown={e => e.key === 'Enter' && runSpy()}
              />
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
        {isLoading && loadingMsg && (
          <p className="text-xs text-purple-400 mb-3 animate-pulse">{loadingMsg}</p>
        )}
        <button
          onClick={runSpy}
          disabled={isLoading}
          className="btn-primary w-full sm:w-auto px-6 py-2.5 min-h-[44px] text-sm flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <><SpinnerIcon /> Fetching reviews…</>
          ) : (
            <><span>🔍</span> Run Competitor Analysis</>
          )}
        </button>
        <p className="text-xs text-gray-600 mt-2">
          Fetches 50 most-recent Google reviews per competitor. May take 1–2 minutes.
        </p>
      </div>

      {/* Results */}
      {hasResults && competitors.length > 0 && (
        <>
          {/* Results header with refresh */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">
                {competitors.map(c => `${c.name}: ${c.fetched_count ?? 0} reviews in DB`).join(' · ')}
              </p>
            </div>
            <button
              onClick={handleRefreshData}
              disabled={isRefreshing}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isRefreshing ? <SpinnerIcon size={3} /> : '↻'} Refresh Data
            </button>
          </div>

          {/* Chart */}
          {chartData.length > 1 && (
            <div className="card p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-200 mb-1">Rating Comparison</h3>
              <p className="text-xs text-gray-500 mb-4">Google average rating vs. competitors</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }} barSize={40}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 5]} tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="rating" name="Avg Rating" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Comparison table */}
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-[#1e2d4a]">
              <h3 className="text-sm font-semibold text-gray-200">Detailed Comparison</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1e2d4a]">
                    {['Business', 'Google Rating', 'Reviews', 'Address'].map(h => (
                      <th key={h} className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2d4a]">
                  {activeBusiness && (
                    <tr className="bg-purple-500/5">
                      <td className="px-3 sm:px-6 py-3 sm:py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                          <span className="text-sm font-semibold text-purple-300">{activeBusiness.name}</span>
                          <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">You</span>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 min-w-[120px]">
                        {activeBusiness.google_rating
                          ? <StarBar rating={activeBusiness.google_rating} />
                          : <span className="text-xs text-gray-600">Not available</span>
                        }
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm text-gray-300">{activeBusiness.total_reviews.toLocaleString()}</td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs text-gray-500">{activeBusiness.location}</td>
                    </tr>
                  )}
                  {competitors.map((c, i) => (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 sm:px-6 py-3 sm:py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500 opacity-70 shrink-0" />
                          <p className="text-sm text-gray-300 truncate">{c.name}</p>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 min-w-[120px]">
                        {c.google_rating !== null
                          ? <StarBar rating={c.google_rating} />
                          : <span className="text-xs text-gray-600">Not found</span>
                        }
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4">
                        {c.fetched_count !== undefined && c.fetched_count > 0 ? (
                          <div>
                            <span className="text-sm font-medium text-gray-200">{c.fetched_count} fetched</span>
                            {c.total_reviews !== null && (
                              <p className="text-xs text-gray-600">of {c.total_reviews.toLocaleString()} on Google</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">
                            {c.total_reviews !== null ? c.total_reviews.toLocaleString() : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs text-gray-500 max-w-[200px] truncate">
                        {c.full_address ?? c.location ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick insight banner */}
          {(() => {
            const withRatings = competitors.filter(c => c.google_rating !== null)
            if (!withRatings.length) return null
            const best = [...withRatings].sort((a, b) => (b.google_rating ?? 0) - (a.google_rating ?? 0))[0]
            const myRating = activeBusiness?.google_rating ?? 0
            const youWin = myRating > 0 && myRating >= (best.google_rating ?? 0)
            return (
              <div className={`card p-4 flex gap-3 ${youWin ? 'border-emerald-500/30' : 'border-amber-500/30'}`}>
                <span className="text-2xl">{youWin ? '🏆' : '⚠️'}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-200 mb-0.5">
                    {youWin ? "You're leading the pack!" : 'Room to improve'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {youWin
                      ? `Your ${myRating}★ rating outperforms your top competitor (${best.name} at ${best.google_rating}★). Keep it up!`
                      : myRating > 0
                        ? `${best.name} leads with ${best.google_rating}★. Focus on response rate and service quality to close the gap.`
                        : `${best.name} has ${best.google_rating}★. Set up your Google Business Profile to start tracking your rating.`
                    }
                  </p>
                </div>
              </div>
            )
          })()}

          {/* Per-competitor AI insight sections */}
          {competitors.filter(c => c.id && (c.fetched_count ?? 0) > 0).length > 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-200">Competitor Intelligence</h3>
                <p className="text-xs text-gray-500 mt-0.5">AI-generated insights based on fetched reviews</p>
              </div>
              {competitors
                .filter(c => c.id && (c.fetched_count ?? 0) > 0)
                .map(comp => (
                  <InsightSection
                    key={comp.id}
                    competitorId={comp.id}
                    competitor={comp}
                    insightState={insightStates[comp.id] ?? { data: null, loading: false, error: '', generated_at: null, cached: false }}
                    onRefresh={handleRefreshInsights}
                  />
                ))
              }
            </div>
          )}
        </>
      )}

    </div>
  )
}
