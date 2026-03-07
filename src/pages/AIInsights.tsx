import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────────

type Impact = 'High' | 'Medium' | 'Low'
type Category = 'Service' | 'Food' | 'Pricing' | 'Ambiance' | 'Trending' | 'Opportunity'

type Insight = {
  id: number
  icon: string
  category: Category
  title: string
  description: string
  recommendation: string
  impact: Impact
}

// ── Styles ──────────────────────────────────────────────────────────────────

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
            <span className={`badge text-xs ${CATEGORY_STYLES[insight.category]}`}>
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

function formatAnalyzedAt(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AIInsights() {
  const { user } = useAuth()
  const hasFetched = useRef(false)
  const [insights, setInsights]     = useState<Insight[]>([])
  const [expanded, setExpanded]     = useState<Set<number>>(new Set())
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null)
  const [filter, setFilter]         = useState<'All' | Impact>('All')
  const [error, setError]           = useState('')
  const [fromCache, setFromCache]   = useState(false)

  useEffect(() => {
    if (user && !hasFetched.current) {
      hasFetched.current = true
      loadInsights()
    }
  }, [user])

  // ── Load: DB-first, only call Anthropic when no cached insights ──────────

  const loadInsights = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    setFromCache(false)

    try {
      // 1. Get user's business
      const { data: bizData, error: bizErr } = await supabase
        .from('businesses')
        .select('id, name, type')
        .eq('user_id', user!.id)
        .limit(1)
        .maybeSingle()
      if (bizErr) throw new Error(`Business load error: ${bizErr.message}`)
      if (!bizData) { setInsights([]); return }

      // 2. Check for cached insights in DB
      if (!forceRefresh) {
        const { data: cached, error: cacheErr } = await supabase
          .from('insights')
          .select('*')
          .eq('business_id', bizData.id)
          .order('created_at', { ascending: false })

        console.log('[AIInsights] cache check — rows:', cached?.length ?? 0, 'error:', cacheErr?.message ?? null)

        if (!cacheErr && cached && cached.length > 0) {
          console.log('[AIInsights] ✅ Loading from cache — NO Anthropic call')
          const loaded = cached.map((row, i) => ({
            id: i,
            icon: row.icon ?? '💡',
            category: row.category as Category,
            title: row.title,
            description: row.description,
            recommendation: row.recommendation,
            impact: row.impact as Impact,
          }))
          setInsights(loaded)
          setAnalyzedAt(cached[0].created_at)
          setFromCache(true)
          return
        }

        // If there's a cache error (e.g., table doesn't exist), do NOT call Anthropic on page load
        if (cacheErr) {
          console.error('[AIInsights] Cache read error — NOT calling Anthropic:', cacheErr.message)
          throw new Error(`Cache error: ${cacheErr.message}. Run the DB migration to create the insights table.`)
        }

        // Only call Anthropic if cache is genuinely empty (0 rows)
        console.log('[AIInsights] 🌐 No cached insights found — will call Anthropic')
      }

      // 3. No cached data (or forced refresh) — fetch reviews and call Anthropic
      console.log('[AIInsights] 🌐 Calling Anthropic API —', forceRefresh ? 'forced refresh' : 'no cache found')
      const { data: revData, error: revErr } = await supabase
        .from('reviews')
        .select('review_text')
        .eq('business_id', bizData.id)
      if (revErr) throw new Error(`Reviews load error: ${revErr.message}`)

      const texts = (revData ?? []).map(r => r.review_text)
      if (texts.length === 0) {
        setInsights([])
        return
      }

      // 4. Call Express backend → Anthropic
      const res = await fetch('/api/generate-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: bizData.name,
          businessType: bizData.type,
          reviews: texts,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(errData.error ?? 'Failed to generate insights')
      }
      const data = await res.json()
      const rawInsights: Omit<Insight, 'id'>[] = data.insights ?? []

      // 5. Delete old insights and save new ones to DB
      await supabase.from('insights').delete().eq('business_id', bizData.id)

      const now = new Date().toISOString()
      const rows = rawInsights.map(ins => ({
        business_id:    bizData.id,
        user_id:        user!.id,
        icon:           ins.icon,
        category:       ins.category,
        title:          ins.title,
        description:    ins.description,
        recommendation: ins.recommendation,
        impact:         ins.impact,
        created_at:     now,
      }))

      if (rows.length > 0) {
        const { error: insertErr } = await supabase.from('insights').insert(rows)
        if (insertErr) {
          console.error('[AIInsights] ❌ insert error (cache NOT saved):', insertErr.message, insertErr.code)
        } else {
          console.log('[AIInsights] ✅ Insights saved to DB —', rows.length, 'rows. Next visit will load from cache.')
        }
      }

      // 6. Update local state
      const insightsWithIds = rawInsights.map((ins, i) => ({ ...ins, id: i }))
      setInsights(insightsWithIds)
      setAnalyzedAt(now)

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load insights'
      console.error('[AIInsights] loadInsights error:', e)
      setError(msg)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filtered = filter === 'All' ? insights : insights.filter(i => i.impact === filter)

  // ── Loading state ──────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">AI Insights</h1>
          {analyzedAt ? (
            <p className="text-gray-500 text-sm mt-1 flex items-center gap-2">
              {fromCache && <span className="text-emerald-600 text-xs">✓ Loaded from cache ·</span>}
              Last updated: {formatAnalyzedAt(analyzedAt)}
            </p>
          ) : (
            <p className="text-gray-500 text-sm mt-1">
              Intelligence generated from your customer reviews.
            </p>
          )}
        </div>
        <button
          onClick={() => loadInsights(true)}
          disabled={refreshing}
          className="btn-primary px-4 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
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
          <button onClick={() => loadInsights()} className="underline hover:no-underline">Retry</button>
        </div>
      )}

      {/* No reviews */}
      {!error && insights.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-3xl mb-3">🧠</p>
          <p className="text-sm text-gray-300 font-medium mb-1">No insights yet</p>
          <p className="text-xs text-gray-500">Add reviews during onboarding to generate AI insights.</p>
        </div>
      )}

      {insights.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="card p-4 flex flex-wrap gap-4">
            {[
              { label: 'Total Insights', value: insights.length,                                        color: 'text-gray-200' },
              { label: 'High Impact',    value: insights.filter(i => i.impact === 'High').length,   color: 'text-red-400' },
              { label: 'Medium Impact',  value: insights.filter(i => i.impact === 'Medium').length, color: 'text-amber-400' },
              { label: 'Low Impact',     value: insights.filter(i => i.impact === 'Low').length,    color: 'text-blue-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className={`text-xl font-bold ${color}`}>{value}</span>
                <span className="text-xs text-gray-500">{label}</span>
                <span className="text-gray-700">·</span>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2">
            {(['All', 'High', 'Medium', 'Low'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
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
