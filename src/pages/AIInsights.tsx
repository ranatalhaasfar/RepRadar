import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAppStore } from '../store/appStore'
import type { Insight } from '../store/appStore'

// ── Styles ──────────────────────────────────────────────────────────────────

type Impact   = 'High' | 'Medium' | 'Low'
type Category = 'Service' | 'Food' | 'Pricing' | 'Ambiance' | 'Trending' | 'Opportunity'

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

  // ── Zustand store ──
  const { insights, insightsLoadedAt, insightsBusinessId, setInsights, clearInsights } = useAppStore()

  // ── Local UI state ──
  const [loading,    setLoading]    = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [noReviews,  setNoReviews]  = useState(false)
  const [fromCache,  setFromCache]  = useState(false)
  const [error,      setError]      = useState('')
  const [filter,     setFilter]     = useState<'All' | Impact>('All')
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set())

  // ── On mount: load from store → Supabase → (never auto-call Anthropic) ──

  useEffect(() => {
    if (!user) return
    loadInsights()
  }, [user?.id])

  const loadInsights = async () => {
    if (!user) return

    // 1️⃣ Zustand store has insights for this user's business → render instantly
    //    (We don't know the business ID yet at this point, but we check after fetching biz)

    setError('')

    // Always fetch business ID first (cheap query)
    const { data: bizData, error: bizErr } = await supabase
      .from('businesses')
      .select('id, name, type')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (bizErr) { setError(`Business load error: ${bizErr.message}`); return }
    if (!bizData) { setLoading(false); return }

    // 1️⃣ Store hit — insights already in memory for this business
    if (insightsBusinessId === bizData.id && insights.length > 0) {
      console.log('[AIInsights] ✅ Store hit — rendering from Zustand, zero DB calls')
      setFromCache(true)
      setLoading(false)
      return
    }

    // 2️⃣ Store miss — try Supabase cache
    setLoading(true)
    try {
      const { data: cached, error: cacheErr } = await supabase
        .from('insights')
        .select('*')
        .eq('business_id', bizData.id)
        .order('created_at', { ascending: false })

      if (cacheErr) {
        throw new Error(`Cache error: ${cacheErr.message}. Run the DB migration to create the insights table.`)
      }

      if (cached && cached.length > 0) {
        // Supabase has rows → load into Zustand store
        console.log('[AIInsights] ✅ Supabase cache hit — saving to Zustand store')
        const loaded: Insight[] = cached.map((row, i) => ({
          id:             i,
          icon:           row.icon ?? '💡',
          category:       row.category,
          title:          row.title,
          description:    row.description,
          recommendation: row.recommendation,
          impact:         row.impact as Impact,
        }))
        setInsights(loaded, bizData.id)
        setFromCache(true)
      } else {
        // Supabase is empty — no auto-call to Anthropic, show empty state
        const { count } = await supabase
          .from('reviews')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bizData.id)
        setNoReviews((count ?? 0) === 0)
        setFromCache(false)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  // ── Refresh: user-initiated only → clears store + DB, regenerates ────────

  const handleRefresh = async () => {
    if (!user) return
    setRefreshing(true)
    setError('')
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
        clearInsights()
        return
      }

      console.log('[AIInsights] 🌐 Refresh clicked — calling Anthropic API')
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

      // Clear old Supabase rows, insert fresh
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
        if (insertErr) console.error('[AIInsights] ❌ insert error:', insertErr.message)
      }

      // Save fresh insights to Zustand store
      const fresh = rawInsights.map((ins, i) => ({ ...ins, id: i }))
      setInsights(fresh, bizData.id)
      setNoReviews(false)
      setFromCache(false)
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

  const filtered = filter === 'All' ? insights : insights.filter(i => i.impact === filter)

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
          {insightsLoadedAt ? (
            <p className="text-gray-500 text-sm mt-1 flex items-center gap-2 flex-wrap">
              {fromCache && <span className="text-emerald-600 text-xs">✓ Loaded from cache ·</span>}
              Last updated: {formatTimestamp(insightsLoadedAt)}
            </p>
          ) : (
            <p className="text-gray-500 text-sm mt-1">
              Intelligence generated from your customer reviews.
            </p>
          )}
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
      {!error && insights.length === 0 && (
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

      {insights.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="card p-4 flex flex-wrap gap-4">
            {[
              { label: 'Total Insights', value: insights.length,                                      color: 'text-gray-200'  },
              { label: 'High Impact',    value: insights.filter(i => i.impact === 'High').length,   color: 'text-red-400'   },
              { label: 'Medium Impact',  value: insights.filter(i => i.impact === 'Medium').length, color: 'text-amber-400' },
              { label: 'Low Impact',     value: insights.filter(i => i.impact === 'Low').length,    color: 'text-blue-400'  },
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
