import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const BUSINESS_TYPES = ['Restaurant', 'Retail', 'Cafe', 'Salon', 'Bar', 'Other']

// ── Steps ──────────────────────────────────────────────────────────────────
// 0: Business Name
// 1: Business Type
// 2: Location
// 3: Confirm Google Maps result
// 4: Fetching reviews (auto-advance)

const STEPS = [
  { label: 'Business Name', icon: '🏢' },
  { label: 'Business Type', icon: '🏷️' },
  { label: 'Location',      icon: '📍' },
  { label: 'Confirm',       icon: '✅' },
]

type SearchResult = {
  place_id:      string
  name:          string
  full_address:  string | null
  rating:        number | null
  reviews_count: number | null
}

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const { user } = useAuth()

  // Step state
  const [step, setStep]         = useState(0)
  const [name, setName]         = useState('')
  const [type, setType]         = useState('')
  const [location, setLocation] = useState('')

  // Search state
  const [searching, setSearching]     = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searchError, setSearchError]   = useState('')

  // Fetch / save state
  const [fetching, setFetching]   = useState(false)
  const [fetchMsg, setFetchMsg]   = useState('')
  const [error, setError]         = useState('')

  // ── Navigation ─────────────────────────────────────────────────────────

  const canNext = () => {
    if (step === 0) return name.trim().length > 0
    if (step === 1) return type.length > 0
    if (step === 2) return location.trim().length > 0
    return false
  }

  const back = () => {
    setError('')
    setSearchError('')
    setSearchResult(null)
    setStep(s => s - 1)
  }

  // ── Step 3: search Google Maps via Outscraper ───────────────────────────

  const searchBusiness = async () => {
    setSearching(true)
    setSearchError('')
    setSearchResult(null)
    setStep(3)
    try {
      const params = new URLSearchParams({ name: name.trim(), city: location.trim() })
      const res = await fetch(`/api/outscraper-search?${params}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `Search failed (${res.status})`)
      }
      const data = await res.json()
      if (!data.found) {
        setSearchError(`We couldn't find "${name.trim()}" in ${location.trim()} on Google Maps. Please check the name and try again.`)
      } else {
        setSearchResult(data)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Search failed'
      setSearchError(msg)
    } finally {
      setSearching(false)
    }
  }

  // ── Step 4: confirm + fetch reviews ────────────────────────────────────

  const handleConfirm = async () => {
    if (!searchResult) return
    setFetching(true)
    setError('')
    setFetchMsg('Creating your business profile…')

    try {
      // 1. Insert business row
      const { data: biz, error: bizErr } = await supabase
        .from('businesses')
        .insert({
          user_id:      user!.id,
          name:         name.trim(),
          type,
          location:     location.trim(),
          place_id:     searchResult.place_id,
          full_address: searchResult.full_address,
          google_rating: searchResult.rating,
          total_reviews: searchResult.reviews_count ?? 0,
        })
        .select()
        .single()
      if (bizErr) throw new Error(`Database error: ${bizErr.message}`)

      // 2. Fetch reviews from Outscraper
      setFetchMsg('Fetching your reviews from Google… (this may take up to 2 minutes)')

      const fetchRes = await fetch('/api/outscraper-reviews', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ place_id: searchResult.place_id, limit: 100, sort: 'newest' }),
      })
      if (!fetchRes.ok) {
        const d = await fetchRes.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to fetch reviews')
      }
      const { reviews } = await fetchRes.json()

      // 3. Save reviews to Supabase
      setFetchMsg(`Saving ${reviews.length} reviews to your dashboard…`)

      if (reviews.length > 0) {
        const rows = reviews.map((r: {
          reviewer_name: string
          review_text:   string
          rating:        number | null
          reviewed_at:   string | null
        }) => ({
          business_id:   biz!.id,
          user_id:       user!.id,
          review_text:   r.review_text,
          reviewer_name: r.reviewer_name,
          rating:        r.rating,
          reviewed_at:   r.reviewed_at,
          sentiment:     null,
        }))
        const { error: revErr } = await supabase.from('reviews').insert(rows)
        if (revErr) throw new Error(`Reviews error: ${revErr.message}`)
      }

      // 4. Stamp reviews_fetched_at
      await supabase
        .from('businesses')
        .update({ reviews_fetched_at: new Date().toISOString() })
        .eq('id', biz!.id)

      onComplete()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unexpected error'
      setError(msg)
      setFetching(false)
      setFetchMsg('')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  // Full-screen fetch loading overlay
  if (fetching) {
    return (
      <div className="min-h-screen bg-[#080d1a] flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="text-5xl animate-bounce">📡</div>
          <div>
            <h2 className="text-xl font-bold text-gray-100 mb-2">Setting Up RepRadar</h2>
            <p className="text-sm text-gray-400 leading-relaxed">{fetchMsg}</p>
          </div>
          <div className="flex justify-center">
            <svg className="animate-spin h-8 w-8 text-purple-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
              {error}
              <button
                onClick={() => { setFetching(false); setError('') }}
                className="block mt-2 text-xs underline hover:no-underline mx-auto"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#080d1a] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-3xl">📡</span>
            <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              RepRadar
            </span>
          </div>
          <p className="text-xs text-gray-600">Let's set up your reputation dashboard</p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-8 px-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full h-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-purple-500' : 'bg-[#1e2d4a]'}`} />
              <span className={`text-[10px] ${i === step ? 'text-purple-400' : 'text-gray-600'}`}>
                {s.icon} {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Step card */}
        <div className="card p-8">

          {/* Step 0: Business name */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-100 mb-1">What's your business called?</h2>
                <p className="text-sm text-gray-500">This is how it will appear on your dashboard.</p>
              </div>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. The Golden Spoon"
                className="input-dark text-sm"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && canNext() && setStep(1)}
              />
            </div>
          )}

          {/* Step 1: Business type */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-100 mb-1">What type of business is it?</h2>
                <p className="text-sm text-gray-500">We'll tailor your insights to your industry.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {BUSINESS_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`px-4 py-3 rounded-xl text-sm font-medium border-2 transition-all duration-150 ${
                      type === t
                        ? 'border-purple-500 bg-purple-500/10 text-purple-300'
                        : 'border-[#1e2d4a] bg-[#080d1a] text-gray-400 hover:border-purple-500/40 hover:text-gray-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Location */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-100 mb-1">Where is your business located?</h2>
                <p className="text-sm text-gray-500">Enter the city or neighbourhood.</p>
              </div>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Austin, TX"
                className="input-dark text-sm"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && canNext() && searchBusiness()}
              />
            </div>
          )}

          {/* Step 3: Confirm Google Maps result */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-100 mb-1">Is this your business?</h2>
                <p className="text-sm text-gray-500">We found this on Google Maps. Confirm to import your reviews.</p>
              </div>

              {searching && (
                <div className="flex items-center gap-3 py-6 justify-center">
                  <svg className="animate-spin h-5 w-5 text-purple-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm text-gray-400">Searching Google Maps…</span>
                </div>
              )}

              {searchError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                  {searchError}
                </div>
              )}

              {searchResult && !searching && (
                <div className="bg-[#080d1a] border border-purple-500/30 rounded-xl p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-100 text-base">{searchResult.name}</p>
                      {searchResult.full_address && (
                        <p className="text-xs text-gray-500 mt-0.5">{searchResult.full_address}</p>
                      )}
                    </div>
                    <span className="text-green-400 text-xl shrink-0">📍</span>
                  </div>
                  <div className="flex items-center gap-4 pt-1">
                    {searchResult.rating !== null && (
                      <div className="flex items-center gap-1">
                        <span className="text-yellow-400 text-sm">★</span>
                        <span className="text-sm font-semibold text-gray-200">{searchResult.rating.toFixed(1)}</span>
                        <span className="text-xs text-gray-500">Google rating</span>
                      </div>
                    )}
                    {searchResult.reviews_count !== null && (
                      <div className="text-xs text-gray-500">
                        {searchResult.reviews_count.toLocaleString()} reviews
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error (general) */}
          {error && !fetching && (
            <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Nav buttons */}
          <div className="flex items-center justify-between mt-6">
            {step > 0 ? (
              <button onClick={back} className="text-sm text-gray-500 hover:text-gray-200 transition-colors px-4 py-2">
                ← Back
              </button>
            ) : <div />}

            {/* Steps 0–1: Continue */}
            {step < 2 && (
              <button
                onClick={() => { setError(''); setStep(s => s + 1) }}
                disabled={!canNext()}
                className="btn-primary px-8 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue →
              </button>
            )}

            {/* Step 2: Search Google Maps */}
            {step === 2 && (
              <button
                onClick={searchBusiness}
                disabled={!canNext() || searching}
                className="btn-primary px-8 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {searching ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Searching…
                  </>
                ) : 'Search Google Maps →'}
              </button>
            )}

            {/* Step 3: Not found → retry; found → confirm */}
            {step === 3 && !searching && (
              <>
                {searchError && (
                  <button
                    onClick={searchBusiness}
                    className="btn-primary px-8 py-2.5 text-sm"
                  >
                    🔍 Try Again
                  </button>
                )}
                {searchResult && (
                  <button
                    onClick={handleConfirm}
                    className="btn-primary px-8 py-2.5 text-sm flex items-center gap-2"
                  >
                    Yes, fetch my reviews →
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Skip / manual entry fallback */}
        {step === 3 && searchError && !searching && (
          <p className="text-center text-xs text-gray-600 mt-4">
            Can't find your business?{' '}
            <button
              onClick={() => setStep(0)}
              className="text-purple-500 hover:text-purple-400 underline"
            >
              Edit your details
            </button>
          </p>
        )}

      </div>
    </div>
  )
}
