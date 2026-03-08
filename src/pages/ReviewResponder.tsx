import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

type Tone = 'Friendly' | 'Professional' | 'Apologetic'

const TONE_OPTIONS: { value: Tone; label: string; description: string; icon: string }[] = [
  { value: 'Friendly',     label: 'Friendly',     description: 'Warm & personable',     icon: '😊' },
  { value: 'Professional', label: 'Professional', description: 'Formal & polished',     icon: '💼' },
  { value: 'Apologetic',   label: 'Apologetic',   description: 'Empathetic & sincere',  icon: '🤝' },
]

function SpinnerIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function ReviewResponder() {
  const { pendingReviewText, setPendingReviewText } = useAppStore()

  const [review, setReview]     = useState('')
  const [tone, setTone]         = useState<Tone>('Professional')
  const [response, setResponse] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied]     = useState(false)
  const [error, setError]       = useState('')
  const responseRef             = useRef<HTMLDivElement>(null)

  // Pre-fill from Dashboard "Respond" button
  useEffect(() => {
    if (pendingReviewText) {
      setReview(pendingReviewText)
      setTone('Apologetic')
      setPendingReviewText(null)
    }
  }, [pendingReviewText])

  const generateResponse = async () => {
    if (!review.trim()) {
      setError('Please paste a customer review before generating.')
      return
    }
    setError('')
    setResponse('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/generate-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review, tone }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to generate response.')
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response body received.')

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) {
              setResponse(prev => prev + parsed.text)
              setTimeout(() => {
                responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }, 50)
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
              throw parseErr
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(response)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setError('Failed to copy. Please select and copy manually.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generateResponse()
  }

  return (
    <div className="w-full max-w-2xl space-y-5 sm:space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-100">Review Responder</h1>
        <p className="text-gray-500 text-sm mt-1">
          Paste any customer review and generate a perfect AI response instantly.
        </p>
      </div>

      {/* Card */}
      <div className="card p-4 sm:p-6 space-y-5 sm:space-y-6">

        {/* Review input */}
        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
            Customer Review
          </label>
          <textarea
            value={review}
            onChange={e => setReview(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste the customer review here…&#10;&#10;Tip: Press Ctrl+Enter to generate."
            rows={6}
            className="input-dark resize-none text-sm leading-relaxed"
          />
          <p className="text-xs text-gray-600 mt-1 text-right">
            {review.length > 0 ? `${review.length} chars` : 'No review entered'}
          </p>
        </div>

        {/* Tone selector */}
        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
            Response Tone
          </label>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {TONE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTone(opt.value)}
                className={`relative flex flex-col items-center gap-1 sm:gap-1.5 p-3 sm:p-4 min-h-[80px] rounded-xl border-2 transition-all duration-150 text-center ${
                  tone === opt.value
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-[#1e2d4a] bg-[#080d1a] hover:border-purple-500/40'
                }`}
              >
                {tone === opt.value && (
                  <span className="absolute top-2 right-2 w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M2 5l2.5 2.5L8 3" />
                    </svg>
                  </span>
                )}
                <span className="text-2xl">{opt.icon}</span>
                <span className={`text-sm font-semibold ${tone === opt.value ? 'text-purple-300' : 'text-gray-300'}`}>
                  {opt.label}
                </span>
                <span className={`text-xs ${tone === opt.value ? 'text-purple-400' : 'text-gray-600'}`}>
                  {opt.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
            <span>⚠</span><span>{error}</span>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={generateResponse}
          disabled={isLoading}
          className="btn-primary w-full py-3.5 min-h-[52px] flex items-center justify-center gap-2 text-sm"
        >
          {isLoading
            ? <><SpinnerIcon className="h-4 w-4" /><span>Generating response…</span></>
            : <><span>✨</span><span>Generate Response</span></>
          }
        </button>

        {/* Response output */}
        {(response || isLoading) && (
          <div ref={responseRef}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Generated Response
                </span>
                {isLoading && (
                  <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse mr-1" />
                    Writing…
                  </span>
                )}
                {!isLoading && response && (
                  <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    ✓ Ready
                  </span>
                )}
              </div>
              {response && !isLoading && (
                <button
                  onClick={copyToClipboard}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all ${
                    copied
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-[#080d1a] border-[#1e2d4a] text-gray-400 hover:border-purple-500/40 hover:text-gray-200'
                  }`}
                >
                  {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
                </button>
              )}
            </div>
            <div className="bg-[#080d1a] border border-[#1e2d4a] rounded-xl p-5 min-h-[80px]">
              {response ? (
                <p className="text-gray-300 leading-relaxed text-sm whitespace-pre-wrap">
                  {response}
                  {isLoading && (
                    <span className="inline-block w-0.5 h-4 bg-purple-400 ml-0.5 animate-pulse align-middle" />
                  )}
                </p>
              ) : (
                <div className="flex items-center gap-2 text-gray-600 text-sm">
                  <SpinnerIcon className="h-4 w-4" />
                  <span>Crafting your response…</span>
                </div>
              )}
            </div>
            {response && !isLoading && (
              <p className="text-xs text-gray-600 mt-2 text-right">
                Powered by Claude AI · {tone} tone
              </p>
            )}
          </div>
        )}

      </div>

      {/* Tips */}
      <div className="card p-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">💡 Pro Tips</p>
        <ul className="space-y-2 text-xs text-gray-500">
          <li className="flex gap-2"><span className="text-purple-500">→</span> Always personalize the generated response with specific details before posting</li>
          <li className="flex gap-2"><span className="text-purple-500">→</span> Respond to negative reviews within 24 hours to minimize damage</li>
          <li className="flex gap-2"><span className="text-purple-500">→</span> Use the Apologetic tone for 1-2 star reviews, Friendly for 4-5 stars</li>
        </ul>
      </div>

    </div>
  )
}
