import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

export default function Login({ onSwitch }: { onSwitch: (page: 'login' | 'signup' | 'forgot') => void }) {
  const { signIn } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) setError(error)
    setLoading(false)
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your RepRadar account"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@business.com"
            required
            className="input-dark text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input-dark text-sm"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full py-3 text-sm"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>

        <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
          <button type="button" onClick={() => onSwitch('forgot')} className="hover:text-purple-400 transition-colors">
            Forgot password?
          </button>
          <button type="button" onClick={() => onSwitch('signup')} className="hover:text-purple-400 transition-colors">
            Create account →
          </button>
        </div>
      </form>
    </AuthShell>
  )
}

// ── Shared shell ───────────────────────────────────────────────────────────

export function AuthShell({ title, subtitle, children }: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#080d1a] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-3xl">📡</span>
            <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              RepRadar
            </span>
          </div>
          <p className="text-[11px] text-gray-600">Your Reputation. Monitored. Analyzed. Protected.</p>
        </div>

        {/* Card */}
        <div className="card p-8">
          <h1 className="text-xl font-bold text-gray-100 mb-1">{title}</h1>
          <p className="text-sm text-gray-500 mb-6">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
