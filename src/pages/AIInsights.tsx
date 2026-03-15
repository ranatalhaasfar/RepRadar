import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAppStore } from '../store/appStore'
import type { Insight } from '../store/appStore'

// ── Styles ──────────────────────────────────────────────────────────────────

type Impact   = 'High' | 'Medium' | 'Low'
type Category = 'Service' | 'Food' | 'Pricing' | 'Ambiance' | 'Trending' | 'Opportunity' | 'Winning'

const IMPACT_STYLES: Record<Impact, string> = {
  High:   'bg-red-500/20 text-red-400 border border-red-500/30',
  Medium: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  Low:    'bg-blue-500/20 text-blue-400 border border-blue-500/30',
}

const CATEGORY_STYLES: Record<Category, string> = {
  Service:     'bg-purple-500/15 text-purple-300',
  Food:        'bg-orange-500/15 text-orange-300',
  Pricing:     'bg-emerald-500/15 text-emerald-300',
  Ambiance:    'bg-blue-500/15 text-blue-300',
  Trending:    'bg-pink-500/15 text-pink-300',
  Opportunity: 'bg-cyan-500/15 text-cyan-300',
  Winning:     'bg-emerald-500/15 text-emerald-300',
}

// ── InsightCard ────────────────────────────────────────────────────────────

function InsightCard({ insight, expanded, onToggle }: {
  insight: Insight
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="card card-hover p-5 flex flex-col gap-3 transition-all duration-200">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{insight.icon}</span>
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`badge text-xs ${CATEGORY_STYLES[insight.category as Category] ?? 'bg-gray-500/15 text-gray-300'}`}>
              {insight.category}
            </span>
            <span className={`badge ${IMPACT_STYLES[insight.impact]}`}>
              {insight.impact} Impact
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-100 leading-snug">
            {insight.title}
          </h3>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">{insight.description}</p>

      {expanded && (
        <div className="bg-[#080d1a] border border-purple-500/20 rounded-lg p-3 mt-1">
          <p className="text-xs font-medium text-purple-400 mb-1">💡 Recommendation</p>
          <p className="text-xs text-gray-300 leading-relaxed">{insight.recommendation}</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onToggle}
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
        >
          {expanded ? '▲ Hide details' : '▼ View recommendation'}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AIInsights() {
  const { user } = useAuth()

  // ── Zustand store (Layer 1) ──
  const {
    activeBusiness,
    insights, insightsLoadedAt, insightsBusinessId,
    setInsights, clearInsights, setShowUpgradeModal,
  } = useAppStore()

  // ── Local UI state ──
  const [loading,    setLoading]    = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [noReviews,  setNoReviews]  = useState(false)
  const [cacheSource, setCacheSource] = useState<'zustand' | 'localStorage' | 'supabase' | 'api' | null>(null)
  const [error,      setError]      = useState('')
  const [filter,     setFilter]     = useState<'All' | Impact>('All')
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set())

  // ── On mount / business switch ──

  useEffect(() => {
    if (!user || !activeBusiness) return
    loadInsights()
  }, [user?.id, activeBusiness?.id])

  const loadInsights = async () => {
    if (!user || !activeBusiness) return
    const bizId = activeBusiness.id
    setError('')
    const localKey = `repradar_insights_${bizId}`

    // ─── Layer 1: Zustand (in-memory, fastest) ───
    if (insightsBusinessId === bizId && Array.isArray(insights) && insights.length > 0) {
      setCacheSource('zustand')
      return
    }

    // ─── Layer 2: localStorage (instant, no network — show immediately) ───
    const rawCached = localStorage.getItem(localKey)
    if (rawCached) {
      try {
        const parsed = JSON.parse(rawCached) as { data: Insight[]; savedAt: number }
        if (Array.isArray(parsed?.data) && parsed.data.length > 0) {
          setInsights(parsed.data, bizId)
          setCacheSource('localStorage')
          // Silently back-fill Zustand; don't return yet — fall through to Supabase
          // validation happens in background without blocking the UI
        }
      } catch {
        localStorage.removeItem(localKey)
      }
    }

    // ─── Layer 3: Supabase (source of truth — cross-device, runs in background) ───
    // Only show spinner if we have nothing to display yet
    if (insightsBusinessId !== bizId || !Array.isArray(insights) || insights.length === 0) {
      setLoading(true)
    }
    try {
      const { data: cached, error: cacheErr } = await supabase
        .from('insights')
        .select('*')
        .eq('business_id', bizId)
        .order('created_at', { ascending: false })

      if (cacheErr) {
        throw new Error(`Cache error: ${cacheErr.message}. Run the DB migration to create the insights table.`)
      }

      if (cached && cached.length > 0) {
        const loaded: Insight[] = cached.map((row, i) => ({
          id:             i,
          icon:           row.icon ?? '💡',
          category:       row.category,
          title:          row.title,
          description:    row.description,
          recommendation: row.recommendation,
          impact:         row.impact as Impact,
        }))
        setInsights(loaded, bizId)
        localStorage.setItem(localKey, JSON.stringify({ data: loaded, savedAt: Date.now() }))
        setCacheSource('supabase')
        return
      }

      // Supabase is empty — if localStorage already populated the UI, keep it
      if (insightsBusinessId === bizId && Array.isArray(insights) && insights.length > 0) {
        return
      }

      // ─── All layers empty — show empty state ───
      const { count } = await supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', bizId)
      setNoReviews((count ?? 0) === 0)
      setCacheSource(null)
    } catch (e: unknown) {
      // If localStorage already loaded data, don't show the error
      if (insightsBusinessId === bizId && Array.isArray(insights) && insights.length > 0) return
      setError(e instanceof Error ? e.message : 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  // ── Refresh: clears all 3 layers, regenerates from Anthropic ─────────────

  const handleRefresh = async () => {
    if (!user || !activeBusiness) return
    const bizId = activeBusiness.id
    setRefreshing(true)
    setError('')
    try {
      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('review_text, rating')
        .eq('business_id', bizId)
      if (revErr) throw new Error(`Reviews load error: ${revErr.message}`)

      const reviews = revData ?? []
      if (reviews.length === 0) {
        setNoReviews(true)
        clearInsights()
        localStorage.removeItem(`repradar_insights_${bizId}`)
        await supabase.from('insights').delete().eq('business_id', bizId)
        return
      }

      // Clear all layers before regenerating so fresh result is the new source of truth
      clearInsights()
      localStorage.removeItem(`repradar_insights_${bizId}`)
      await supabase.from('insights').delete().eq('business_id', bizId)

      const res = await fetch('/api/generate-insights', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          business_id:  bizId,
          user_id:      user.id,
          businessName: activeBusiness.name,
          businessType: activeBusiness.type,
          reviews,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }))
        if (errData.error === 'upgrade_required') { setShowUpgradeModal(true); return }
        throw new Error(errData.error ?? 'Failed to generate insights')
      }
      const data = await res.json()
      console.log('[AIInsights] API response:', data)

      if (!data.insights || data.insights.length === 0) {
        throw new Error(data.error ?? 'No insights returned — the AI may have received too few reviews')
      }

      // API now saves to Supabase itself — just update local layers
      const rawInsights: Omit<Insight, 'id'>[] = data.insights
      const fresh = rawInsights.map((ins, i) => ({ ...ins, id: i }))

      localStorage.setItem(`repradar_insights_${bizId}`, JSON.stringify({ data: fresh, savedAt: Date.now() }))
      setInsights(fresh, bizId)
      setNoReviews(false)
      setCacheSource('api')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate insights')
    } finally {
      setRefreshing(false)
    }
  }

  // ── UI helpers ───────────────────────────────────────────────────────────

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const safeInsights = Array.isArray(insights) ? insights : []
  const filtered = filter === 'All' ? safeInsights : safeInsights.filter(i => i.impact === filter)

  const cacheLabel = cacheSource === 'zustand'
    ? '⚡ From memory'
    : cacheSource === 'localStorage'
    ? '💾 From browser cache'
    : cacheSource === 'supabase'
    ? '🗄 From database'
    : cacheSource === 'api'
    ? '✨ Just generated'
    : null

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500 text-sm">
        <svg className="animate-spin h-6 w-6 text-purple-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Loading AI insights…</span>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-100">AI Insights</h1>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {cacheLabel && (
              <span className="text-emerald-500 text-xs">{cacheLabel}</span>
            )}
            {insightsLoadedAt ? (
              <p className="text-gray-500 text-xs">
                {cacheLabel ? '·' : ''} Last updated: {formatTimestamp(insightsLoadedAt)}
              </p>
            ) : (
              <p className="text-gray-500 text-sm">Intelligence generated from your customer reviews.</p>
            )}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-primary w-full sm:w-auto px-4 py-2 min-h-[44px] text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {refreshing ? (
            <>
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Analyzing…
            </>
          ) : '✨ Refresh Insights'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="card p-4 text-red-400 text-sm flex items-center gap-3">
          <span>⚠ {error}</span>
          <button onClick={loadInsights} className="underline hover:no-underline">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!error && safeInsights.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-3xl mb-3">{noReviews ? '📋' : '🧠'}</p>
          <p className="text-sm text-gray-300 font-medium mb-1">
            {noReviews ? 'No reviews yet' : 'No insights generated yet'}
          </p>
          <p className="text-xs text-gray-500">
            {noReviews
              ? 'Fetch your Google reviews first, then click Refresh Insights to generate AI analysis.'
              : 'Click "Refresh Insights" above to generate AI insights from your reviews.'}
          </p>
        </div>
      )}

      {safeInsights.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="card p-4 flex flex-wrap gap-4">
            {[
              { label: 'Total Insights', value: safeInsights.length,                                          color: 'text-gray-200'  },
              { label: 'High Impact',    value: safeInsights.filter(i => i.impact === 'High').length,   color: 'text-red-400'   },
              { label: 'Medium Impact',  value: safeInsights.filter(i => i.impact === 'Medium').length, color: 'text-amber-400' },
              { label: 'Low Impact',     value: safeInsights.filter(i => i.impact === 'Low').length,    color: 'text-blue-400'  },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className={`text-xl font-bold ${color}`}>{value}</span>
                <span className="text-xs text-gray-500">{label}</span>
                <span className="text-gray-700">·</span>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {(['All', 'High', 'Medium', 'Low'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border transition-all whitespace-nowrap ${
                  filter === f
                    ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                    : 'bg-transparent border-[#1e2d4a] text-gray-500 hover:border-purple-500/30 hover:text-gray-300'
                }`}
              >
                {f} {f !== 'All' && 'Impact'}
              </button>
            ))}
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map(insight => (
              <InsightCard
                key={insight.id}
                insight={insight}
                expanded={expanded.has(insight.id)}
                onToggle={() => toggle(insight.id)}
              />
            ))}
          </div>

          {/* Footer note */}
          <div className="card p-4 flex gap-3 items-start">
            <span className="text-xl">🤖</span>
            <div>
              <p className="text-xs font-medium text-gray-300 mb-1">About AI Insights</p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Insights are generated by Claude AI analyzing patterns in your customer reviews.
                High-impact items should be addressed within 7 days for maximum reputation benefit.
              </p>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
