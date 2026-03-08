import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Business } from '../lib/supabase'

// ── Outscraper limits ──────────────────────────────────────────────────────

const MAX_COMPETITOR_FETCH = 200 // Reviews per competitor

// ── Types ──────────────────────────────────────────────────────────────────

type CompetitorEntry = {
  id:            string
  name:          string
  location:      string
  place_id:      string | null
  full_address:  string | null
  google_rating: number | null
  total_reviews: number | null
  reviews_fetched_at: string | null
}

type AIComparison = {
  summary:   string
  strengths: string[]
  gaps:      string[]
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

function SpinnerIcon() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function CompetitorSpy() {
  const { user } = useAuth()
  const [business, setBusiness]           = useState<Business | null>(null)
  const [myReviewTexts, setMyReviewTexts] = useState<string[]>([])

  // Inputs: name + city pairs
  const [inputs, setInputs] = useState([
    { name: '', city: '' },
    { name: '', city: '' },
    { name: '', city: '' },
  ])

  const [competitors, setCompetitors]     = useState<CompetitorEntry[]>([])
  const [comparison, setComparison]       = useState<AIComparison | null>(null)
  const [isLoading, setIsLoading]         = useState(false)
  const [loadingMsg, setLoadingMsg]       = useState('')
  const [error, setError]                 = useState('')
  const [hasResults, setHasResults]       = useState(false)

  // ── Load existing business + cached competitors ──────────────────────────

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const { data: biz } = await supabase
        .from('businesses')
        .select('*')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (!biz) return
      setBusiness(biz)

      // Load my reviews for AI comparison
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
        setCompetitors(comps)
        setHasResults(true)
        // Pre-fill inputs
        setInputs(
          comps.slice(0, 3).map(c => ({ name: c.name, city: c.location ?? '' })).concat(
            Array(Math.max(0, 3 - comps.length)).fill({ name: '', city: '' })
          ).slice(0, 3)
        )
      }
    })()
  }, [user])

  const updateInput = (i: number, field: 'name' | 'city', val: string) => {
    setInputs(prev => { const next = [...prev]; next[i] = { ...next[i], [field]: val }; return next })
  }

  // ── Run competitor spy ───────────────────────────────────────────────────

  const runSpy = async () => {
    const entries = inputs.filter(v => v.name.trim())
    if (entries.length === 0) { setError('Enter at least one competitor name.'); return }

    setError('')
    setIsLoading(true)
    setHasResults(false)
    setComparison(null)

    try {
      const results: CompetitorEntry[] = []
      const allCompReviews: { name: string; reviews: string[] }[] = []

      for (const entry of entries) {
        const compName = entry.name.trim()
        const compCity = entry.city.trim() || business?.location || ''

        // 1. Search Google Maps via Outscraper
        setLoadingMsg(`Searching Google Maps for "${compName}"…`)
        const qs = new URLSearchParams({ name: compName, city: compCity })
        const searchRes  = await fetch(`/api/outscraper-search?${qs}`)
        const searchData = await searchRes.json()

        if (!searchRes.ok || !searchData.found) {
          results.push({
            id: '', name: compName, location: compCity,
            place_id: null, full_address: null,
            google_rating: null, total_reviews: null,
            reviews_fetched_at: null,
          })
          continue
        }

        // 2. Fetch reviews for this competitor
        setLoadingMsg(`Fetching reviews for "${searchData.name}"… (may take up to 2 min)`)
        const revRes = await fetch('/api/outscraper-reviews', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ place_id: searchData.place_id, limit: MAX_COMPETITOR_FETCH, sort: 'newest' }),
        })
        const revData = revRes.ok ? await revRes.json() : { reviews: [] }
        const fetchedReviews: string[] = (revData.reviews ?? []).map((r: { review_text: string }) => r.review_text)

        if (fetchedReviews.length > 0) {
          allCompReviews.push({ name: searchData.name, reviews: fetchedReviews })
        }

        results.push({
          id: '', name: searchData.name, location: compCity,
          place_id:      searchData.place_id,
          full_address:  searchData.full_address,
          google_rating: searchData.rating,
          total_reviews: searchData.reviews_count,
          reviews_fetched_at: new Date().toISOString(),
        })
      }

      // 3. Save competitors to DB
      if (business) {
        setLoadingMsg('Saving competitor data…')
        await supabase.from('competitors').delete().eq('business_id', business.id)
        const rows = results.map(r => ({
          business_id:        business.id,
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
      }

      setCompetitors(results)
      setHasResults(true)

      // 4. AI comparison if we have reviews
      if (myReviewTexts.length > 0 && allCompReviews.length > 0) {
        setLoadingMsg('Generating AI comparison…')
        try {
          const compBlock = allCompReviews.map(c =>
            `${c.name}:\n${c.reviews.slice(0, 15).join('\n')}`
          ).join('\n\n---\n\n')

          const aiRes = await fetch('/api/generate-insights', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessName: business?.name ?? 'My Business',
              businessType: business?.type ?? 'Business',
              reviews: [
                '=== MY BUSINESS REVIEWS ===',
                ...myReviewTexts.slice(0, 20),
                '=== COMPETITOR REVIEWS ===',
                compBlock,
              ],
            }),
          })
          if (aiRes.ok) {
            const aiData = await aiRes.json()
            // Extract a summary and strengths/gaps from the insights
            const insights = aiData.insights ?? []
            const strengths = insights
              .filter((i: { impact: string }) => i.impact === 'High')
              .map((i: { title: string }) => i.title)
              .slice(0, 3)
            const gaps = insights
              .filter((i: { impact: string }) => i.impact !== 'High')
              .map((i: { title: string }) => i.title)
              .slice(0, 3)
            setComparison({
              summary: `Analyzed ${myReviewTexts.length} of your reviews vs ${allCompReviews.reduce((sum, c) => sum + c.reviews.length, 0)} competitor reviews.`,
              strengths,
              gaps,
            })
          }
        } catch {
          // AI comparison is best-effort — don't fail the whole run
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
    { name: 'You', rating: business?.google_rating ?? 0, fill: '#a855f7' },
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Competitor Spy</h1>
          <p className="text-gray-500 text-sm mt-1">
            Fetch real Google reviews from competitors and compare with AI.
          </p>
        </div>
        <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-3 py-1">
          🌐 Live Data
        </span>
      </div>

      {/* Input card */}
      <div className="card p-6">
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
                placeholder={`City (optional, defaults to ${business?.location ?? 'your city'})`}
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
          className="btn-primary px-6 py-2.5 text-sm flex items-center gap-2"
        >
          {isLoading ? (
            <><SpinnerIcon /> Fetching reviews…</>
          ) : (
            <><span>🔍</span> Run Competitor Analysis</>
          )}
        </button>
        <p className="text-xs text-gray-600 mt-2">
          Fetches up to 50 real Google reviews per competitor. May take 1–2 minutes.
        </p>
      </div>

      {/* Results */}
      {hasResults && competitors.length > 0 && (
        <>
          {/* Chart */}
          {chartData.length > 1 && (
            <div className="card p-6">
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

          {/* AI Comparison */}
          {comparison && (
            <div className="card p-6 border-purple-500/20 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">🤖</span>
                <h3 className="text-sm font-semibold text-gray-200">AI Competitive Analysis</h3>
              </div>
              <p className="text-xs text-gray-500">{comparison.summary}</p>
              {comparison.strengths.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-emerald-400 mb-2">✅ Your Strengths</p>
                  <ul className="space-y-1">
                    {comparison.strengths.map((s, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                        <span className="text-emerald-500 mt-0.5 shrink-0">›</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {comparison.gaps.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-400 mb-2">⚠ Opportunities</p>
                  <ul className="space-y-1">
                    {comparison.gaps.map((g, i) => (
                      <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5 shrink-0">›</span>
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Comparison table */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1e2d4a]">
              <h3 className="text-sm font-semibold text-gray-200">Detailed Comparison</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1e2d4a]">
                    {['Business', 'Google Rating', 'Total Reviews', 'Address'].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2d4a]">
                  {business && (
                    <tr className="bg-purple-500/5">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                          <span className="text-sm font-semibold text-purple-300">{business.name}</span>
                          <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">You</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 min-w-[140px]">
                        {business.google_rating
                          ? <StarBar rating={business.google_rating} />
                          : <span className="text-xs text-gray-600">Not available</span>
                        }
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300">{business.total_reviews.toLocaleString()}</td>
                      <td className="px-6 py-4 text-xs text-gray-500">{business.location}</td>
                    </tr>
                  )}
                  {competitors.map((c, i) => (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500 opacity-70 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm text-gray-300 truncate">{c.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 min-w-[140px]">
                        {c.google_rating !== null
                          ? <StarBar rating={c.google_rating} />
                          : <span className="text-xs text-gray-600">Not found</span>
                        }
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-400">
                        {c.total_reviews !== null ? c.total_reviews.toLocaleString() : '—'}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 max-w-[200px] truncate">
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
            const myRating = business?.google_rating ?? 0
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
        </>
      )}

    </div>
  )
}
