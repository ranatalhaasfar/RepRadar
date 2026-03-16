import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { AuthShell } from './Login'

export default function Signup({ onSwitch }: { onSwitch: (page: 'login' | 'signup' | 'forgot') => void }) {
  const { signUp } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    const { error } = await signUp(email, password)
    if (error) { setError(error); setLoading(false); return }
    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <AuthShell title="Check your email" subtitle="One more step">
        <div className="text-center space-y-4">
          <div className="text-5xl">📬</div>
          <p className="text-sm text-black/50">
            We sent a confirmation link to <span className="text-black/70 font-medium">{email}</span>.
            Click it to activate your account, then come back and sign in.
          </p>
          <button onClick={() => onSwitch('login')} className="btn-primary w-full py-3 text-sm">
            Back to Sign In
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start monitoring your reputation for free"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-black/40 uppercase tracking-wider mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@business.com"
            required
            className="input text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-black/40 uppercase tracking-wider mb-1.5">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
            className="input text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-black/40 uppercase tracking-wider mb-1.5">
            Confirm Password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
            className="input text-sm"
          />
        </div>

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full py-3 text-sm"
        >
          {loading ? 'Creating account…' : 'Create Account'}
        </button>

        <p className="text-center text-xs text-black/35">
          Already have an account?{' '}
          <button type="button" onClick={() => onSwitch('login')} className="text-emerald-600 hover:text-emerald-500 transition-colors font-medium">
            Sign in
          </button>
        </p>
      </form>
    </AuthShell>
  )
}
