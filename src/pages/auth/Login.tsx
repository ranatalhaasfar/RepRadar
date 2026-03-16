import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Radar } from 'lucide-react'

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
    <AuthShell title="Welcome back" subtitle="Sign in to your RepRadar account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-black/40 uppercase tracking-wider mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@business.com"
            required
            className="input"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-black/40 uppercase tracking-wider mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="input"
          />
        </div>
        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm">
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
        <div className="flex items-center justify-between text-xs text-black/35 pt-1">
          <button type="button" onClick={() => onSwitch('forgot')} className="hover:text-black/60 transition-colors">
            Forgot password?
          </button>
          <button type="button" onClick={() => onSwitch('signup')} className="hover:text-black/60 transition-colors font-medium">
            Create account →
          </button>
        </div>
      </form>
    </AuthShell>
  )
}

// ── Shared auth shell ───────────────────────────────────────────────────────

export function AuthShell({ title, subtitle, children }: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(145deg, #E8F0EC 0%, #E2EBE5 20%, #E6E8EB 40%, #EDE5E0 60%, #F0EDE8 80%, #EBE8E4 100%)' }}>
      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-[120px]" style={{ background: 'rgba(52,211,153,0.12)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full blur-[120px]" style={{ background: 'rgba(96,165,250,0.08)' }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 flex items-center justify-center shadow-lg" style={{ boxShadow: '0 4px 16px rgba(16,185,129,0.3)' }}>
              <Radar className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-extrabold text-black/80 tracking-tight">RepRadar</span>
          </div>
          <p className="text-xs text-black/35">Your Reputation. Monitored. Analyzed. Protected.</p>
        </div>

        {/* Card */}
        <div className="glass-card p-8">
          <h1 className="text-xl font-bold text-black/80 mb-1">{title}</h1>
          <p className="text-sm text-black/40 mb-6">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
