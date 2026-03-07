import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { supabase } from './lib/supabase'
import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import ForgotPassword from './pages/auth/ForgotPassword'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import ReviewResponder from './pages/ReviewResponder'
import CompetitorSpy from './pages/CompetitorSpy'
import AIInsights from './pages/AIInsights'
import AlertSettings from './pages/AlertSettings'

// ── Types ──────────────────────────────────────────────────────────────────

type Page     = 'dashboard' | 'responder' | 'competitors' | 'insights' | 'alerts'
type AuthPage = 'login' | 'signup' | 'forgot'

type NavItem = {
  id: Page
  label: string
  icon: string
  badge?: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',   label: 'Dashboard',       icon: '📊' },
  { id: 'responder',   label: 'Review Responder', icon: '✍️',  badge: undefined },
  { id: 'competitors', label: 'Competitor Spy',   icon: '🔍' },
  { id: 'insights',    label: 'AI Insights',      icon: '🧠',  badge: 'AI' },
  { id: 'alerts',      label: 'Alert Settings',   icon: '🔔' },
]

const PAGE_TITLES: Record<Page, string> = {
  dashboard:   'Dashboard',
  responder:   'Review Responder',
  competitors: 'Competitor Spy',
  insights:    'AI Insights',
  alerts:      'Alert Settings',
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ active, onNavigate, businessName, userEmail, onSignOut }: {
  active: Page
  onNavigate: (p: Page) => void
  businessName: string
  userEmail: string
  onSignOut: () => void
}) {
  return (
    <aside className="fixed inset-y-0 left-0 w-60 bg-[#0a1020] border-r border-[#1e2d4a] flex flex-col z-30">

      {/* Logo */}
      <div className="px-6 py-6 border-b border-[#1e2d4a]">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="text-2xl">📡</span>
          <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent tracking-tight">
            RepRadar
          </span>
        </div>
        <p className="text-[10px] text-gray-600 leading-tight pl-0.5">
          Your Reputation. Monitored.<br />Analyzed. Protected.
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                isActive
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  : 'text-gray-500 hover:text-gray-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`text-base transition-transform duration-150 ${isActive ? '' : 'group-hover:scale-110'}`}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/30 text-purple-300">
                  {item.badge}
                </span>
              )}
              {isActive && <span className="w-1 h-1 rounded-full bg-purple-400 flex-shrink-0" />}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-[#1e2d4a]">
        {/* User row */}
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {(businessName || userEmail)[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-300 truncate">{businessName || 'My Business'}</p>
            <p className="text-[10px] text-gray-600 truncate">{userEmail}</p>
          </div>
        </div>
        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20"
        >
          <span>🚪</span>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}

// ── TopBar ─────────────────────────────────────────────────────────────────

function TopBar({ page }: { page: Page }) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <header className="h-14 bg-[#0a1020]/80 backdrop-blur border-b border-[#1e2d4a] flex items-center justify-between px-6 sticky top-0 z-20">
      <h2 className="text-sm font-semibold text-gray-200">{PAGE_TITLES[page]}</h2>
      <div className="flex items-center gap-4">
        <span className="text-xs text-gray-600 hidden sm:block">{dateStr}</span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-gray-500">Live</span>
        </div>
      </div>
    </header>
  )
}

// ── Inner app (authenticated) ──────────────────────────────────────────────

function AuthenticatedApp() {
  const { user, signOut } = useAuth()
  const [page, setPage]               = useState<Page>('dashboard')
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null)
  const [businessName, setBusinessName] = useState('')

  useEffect(() => {
    if (!user) return
    // Check if the user has completed onboarding (has a business row)
    supabase
      .from('businesses')
      .select('id, name')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setHasOnboarded(!!data)
        if (data) setBusinessName(data.name)
      })
  }, [user])

  const handleOnboardingComplete = async () => {
    // Refresh business name
    const { data } = await supabase
      .from('businesses')
      .select('name')
      .eq('user_id', user!.id)
      .limit(1)
      .maybeSingle()
    if (data) setBusinessName(data.name)
    setHasOnboarded(true)
  }

  // Loading state while we check for onboarding status
  if (hasOnboarded === null) {
    return (
      <div className="min-h-screen bg-[#080d1a] flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-purple-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  // Onboarding
  if (!hasOnboarded) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  return (
    <div className="min-h-screen bg-[#080d1a]">
      <Sidebar
        active={page}
        onNavigate={setPage}
        businessName={businessName}
        userEmail={user?.email ?? ''}
        onSignOut={signOut}
      />
      <div className="ml-60 flex flex-col min-h-screen">
        <TopBar page={page} />
        {/*
          Pages are always mounted — never unmounted on tab switch.
          This prevents useEffect from re-firing and re-calling Anthropic on every visit.
          CSS hidden keeps non-active pages invisible but preserves their state.
        */}
        <main className="flex-1 p-6 overflow-auto">
          <div className={page === 'dashboard'   ? '' : 'hidden'}><Dashboard /></div>
          <div className={page === 'responder'   ? '' : 'hidden'}><ReviewResponder /></div>
          <div className={page === 'competitors' ? '' : 'hidden'}><CompetitorSpy /></div>
          <div className={page === 'insights'    ? '' : 'hidden'}><AIInsights /></div>
          <div className={page === 'alerts'      ? '' : 'hidden'}><AlertSettings /></div>
        </main>
      </div>
    </div>
  )
}

// ── Unauthenticated flow ───────────────────────────────────────────────────

function UnauthenticatedApp() {
  const [authPage, setAuthPage] = useState<AuthPage>('login')

  if (authPage === 'signup') return <Signup  onSwitch={setAuthPage} />
  if (authPage === 'forgot') return <ForgotPassword onSwitch={setAuthPage} />
  return <Login onSwitch={setAuthPage} />
}

// ── Root router ────────────────────────────────────────────────────────────

function Root() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080d1a] flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-purple-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return session ? <AuthenticatedApp /> : <UnauthenticatedApp />
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
