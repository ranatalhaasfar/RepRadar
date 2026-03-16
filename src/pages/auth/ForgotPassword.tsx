import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { AuthShell } from './Login'

export default function ForgotPassword({ onSwitch }: { onSwitch: (page: 'login' | 'signup' | 'forgot') => void }) {
  const { resetPassword } = useAuth()
  const [email, setEmail]   = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]     = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await resetPassword(email)
    if (error) { setError(error); setLoading(false); return }
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <AuthShell title="Email sent!" subtitle="Check your inbox">
        <div className="text-center space-y-4">
          <div className="text-5xl">✉️</div>
          <p className="text-sm text-black/50">
            We sent a password reset link to <span className="text-black/70 font-medium">{email}</span>.
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
      title="Reset your password"
      subtitle="Enter your email and we'll send a reset link"
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
          {loading ? 'Sending…' : 'Send Reset Link'}
        </button>

        <p className="text-center text-xs text-black/35">
          Remembered it?{' '}
          <button type="button" onClick={() => onSwitch('login')} className="text-emerald-600 hover:text-emerald-500 transition-colors font-medium">
            Sign in
          </button>
        </p>
      </form>
    </AuthShell>
  )
}
