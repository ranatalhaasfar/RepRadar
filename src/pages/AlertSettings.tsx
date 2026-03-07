import { useState } from 'react'

type AlertToggle = {
  id: string
  label: string
  description: string
  enabled: boolean
}

const DEFAULT_ALERTS: AlertToggle[] = [
  { id: 'one_star',    label: 'New 1-star review received',       description: 'Get alerted the moment a negative review is posted.',        enabled: true  },
  { id: 'two_star',    label: 'New 2-star review received',       description: 'Track reviews that need attention before they escalate.',     enabled: true  },
  { id: 'competitor',  label: 'Competitor rating changes',        description: 'Know when a competitor\'s score shifts significantly.',       enabled: false },
  { id: 'no_response', label: 'Review unanswered for 24+ hours', description: 'Never miss a review that\'s waiting for your response.',      enabled: true  },
  { id: 'weekly',      label: 'Weekly reputation summary',       description: 'Receive a digest every Monday with your week\'s highlights.',  enabled: true  },
  { id: 'score_drop',  label: 'Reputation score drops >5 pts',   description: 'Immediate alert if your overall score declines sharply.',     enabled: false },
]

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 flex-shrink-0 ${
        enabled ? 'bg-purple-600' : 'bg-[#1e2d4a]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 border-b border-[#1e2d4a]">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

export default function AlertSettings() {
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [email, setEmail]               = useState('')
  const [smsEnabled, setSmsEnabled]     = useState(false)
  const [phone, setPhone]               = useState('')
  const [alerts, setAlerts]             = useState<AlertToggle[]>(DEFAULT_ALERTS)
  const [saved, setSaved]               = useState(false)
  const [errors, setErrors]             = useState<Record<string, string>>({})

  const toggleAlert = (id: string, val: boolean) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: val } : a))
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (emailEnabled && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      e.email = 'Please enter a valid email address.'
    }
    if (smsEnabled && !phone.match(/^\+?[\d\s\-().]{7,}$/)) {
      e.phone = 'Please enter a valid phone number.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const save = () => {
    if (!validate()) return
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Alert Settings</h1>
        <p className="text-gray-500 text-sm mt-1">
          Configure how and when RepRadar notifies you about your reputation.
        </p>
      </div>

      {/* Email alerts */}
      <Section title="📧 Email Alerts">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-200">Enable email notifications</p>
              <p className="text-xs text-gray-500 mt-0.5">Receive alerts directly in your inbox</p>
            </div>
            <Toggle enabled={emailEnabled} onChange={setEmailEnabled} />
          </div>
          {emailEnabled && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourbusiness.com"
                className={`input-dark text-sm ${errors.email ? 'border-red-500/50 focus:ring-red-500/30' : ''}`}
              />
              {errors.email && (
                <p className="text-xs text-red-400 mt-1">{errors.email}</p>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* SMS alerts */}
      <Section title="📱 SMS Alerts">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-200">Enable SMS notifications</p>
              <p className="text-xs text-gray-500 mt-0.5">Get instant text alerts for critical reviews</p>
            </div>
            <Toggle enabled={smsEnabled} onChange={setSmsEnabled} />
          </div>
          {smsEnabled && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className={`input-dark text-sm ${errors.phone ? 'border-red-500/50 focus:ring-red-500/30' : ''}`}
              />
              {errors.phone && (
                <p className="text-xs text-red-400 mt-1">{errors.phone}</p>
              )}
              <p className="text-xs text-gray-600 mt-1">Standard message rates may apply.</p>
            </div>
          )}
        </div>
      </Section>

      {/* Alert triggers */}
      <Section title="🔔 Alert Triggers">
        <div className="space-y-4">
          {alerts.map(alert => (
            <div key={alert.id} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-200">{alert.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{alert.description}</p>
              </div>
              <Toggle enabled={alert.enabled} onChange={v => toggleAlert(alert.id, v)} />
            </div>
          ))}
        </div>
      </Section>

      {/* Notification frequency */}
      <Section title="⏱ Notification Frequency">
        <div className="space-y-3">
          <p className="text-xs text-gray-500 mb-4">
            Set the maximum frequency for non-critical alerts to avoid notification fatigue.
          </p>
          {(['Immediately', 'Every hour', 'Daily digest', 'Weekly only'] as const).map(freq => (
            <label key={freq} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="frequency"
                defaultChecked={freq === 'Immediately'}
                className="accent-purple-500"
              />
              <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors">
                {freq}
              </span>
            </label>
          ))}
        </div>
      </Section>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          onClick={save}
          className="btn-primary px-8 py-3 text-sm"
        >
          Save Settings
        </button>
        {saved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm animate-pulse">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Settings saved successfully!
          </div>
        )}
      </div>

    </div>
  )
}
