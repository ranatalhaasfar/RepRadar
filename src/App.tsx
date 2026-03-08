import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { useAppStore } from './store/appStore'
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
  { id: 'responder',   label: 'Responder',        icon: '✍️' },
  { id: 'competitors', label: 'Competitors',      icon: '🔍' },
  { id: 'insights',    label: 'AI Insights',      icon: '🧠', badge: 'AI' },
  { id: 'alerts',      label: 'Alerts',           icon: '🔔' },
]

const PAGE_TITLES: Record<Page, string> = {
  dashboard:   'Dashboard',
  responder:   'Review Responder',
  competitors: 'Competitor Spy',
  insights:    'AI Insights',
  alerts:      'Alert Settings',
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ active, onNavigate, businessName, userEmail, onSignOut, onClose }: {
  active: Page
  onNavigate: (p: Page) => void
  businessName: string
  userEmail: string
  onSignOut: () => void
  onClose?: () => void
}) {
  const handleNav = (p: Page) => {
    onNavigate(p)
    onClose?.()
  }

  return (
    <aside className="flex flex-col h-full bg-[#0a1020] border-r border-[#1e2d4a]">

      {/* Logo */}
      <div className="px-6 py-5 border-b border-[#1e2d4a] flex items-center justify-between">
        <div>
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
        {/* Close button — mobile only */}
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-2 text-gray-500 hover:text-gray-200 hover:bg-white/5 rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-150 group ${
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
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {(businessName || userEmail)[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-300 truncate">{businessName || 'My Business'}</p>
            <p className="text-[10px] text-gray-600 truncate">{userEmail}</p>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20 min-h-[44px]"
        >
          <span>🚪</span>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}

// ── TopBar ─────────────────────────────────────────────────────────────────

function TopBar({ page, onMenuOpen }: { page: Page; onMenuOpen: () => void }) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <header className="h-14 bg-[#0a1020]/80 backdrop-blur border-b border-[#1e2d4a] flex items-center justify-between px-4 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuOpen}
          className="lg:hidden p-2 text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h2 className="text-sm font-semibold text-gray-200">{PAGE_TITLES[page]}</h2>
      </div>
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

// ── BottomNav — mobile only ────────────────────────────────────────────────

function BottomNav({ active, onNavigate }: { active: Page; onNavigate: (p: Page) => void }) {
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-[#0a1020] border-t border-[#1e2d4a] z-30 flex">
      {NAV_ITEMS.map(item => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] transition-colors relative ${
              isActive ? 'text-purple-400' : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {isActive && (
              <span className="absolute top-0 inset-x-0 h-0.5 bg-purple-500 rounded-b" />
            )}
            <span className="text-xl leading-none">{item.icon}</span>
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
            {item.badge && (
              <span className="absolute top-1.5 right-1/2 translate-x-3 text-[8px] font-bold px-1 py-px rounded-full bg-purple-500/40 text-purple-300">
                {item.badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

// ── Inner app (authenticated) ──────────────────────────────────────────────

function AuthenticatedApp() {
  const { user, signOut } = useAuth()
  const clearAll = useAppStore(s => s.clearAll)
  const [page, setPage]               = useState<Page>('dashboard')
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [sidebarOpen, setSidebarOpen]   = useState(false)

  useEffect(() => {
    if (!user) return
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

  const handleSignOut = () => {
    clearAll()
    signOut()
  }

  const handleOnboardingComplete = async () => {
    const { data } = await supabase
      .from('businesses')
      .select('name')
      .eq('user_id', user!.id)
      .limit(1)
      .maybeSingle()
    if (data) setBusinessName(data.name)
    setHasOnboarded(true)
  }

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

  if (!hasOnboarded) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  return (
    <div className="min-h-screen bg-[#080d1a]">

      {/* ── Desktop sidebar (always visible on lg+) ── */}
      <div className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30">
        <Sidebar
          active={page}
          onNavigate={setPage}
          businessName={businessName}
          userEmail={user?.email ?? ''}
          onSignOut={handleSignOut}
        />
      </div>

      {/* ── Mobile overlay sidebar ── */}
      {sidebarOpen && (
        <>
          {/* Backdrop */}
          <div
            className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Drawer */}
          <div className="lg:hidden fixed inset-y-0 left-0 w-72 z-50">
            <Sidebar
              active={page}
              onNavigate={setPage}
              businessName={businessName}
              userEmail={user?.email ?? ''}
              onSignOut={handleSignOut}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <div className="lg:ml-60 flex flex-col min-h-screen">
        <TopBar page={page} onMenuOpen={() => setSidebarOpen(true)} />
        {/*
          Pages are always mounted — never unmounted on tab switch.
          CSS hidden keeps non-active pages invisible but preserves state/avoids Anthropic re-calls.
        */}
        <main className="flex-1 p-4 md:p-6 overflow-auto pb-20 lg:pb-6">
          <div className={page === 'dashboard'   ? '' : 'hidden'}><Dashboard /></div>
          <div className={page === 'responder'   ? '' : 'hidden'}><ReviewResponder /></div>
          <div className={page === 'competitors' ? '' : 'hidden'}><CompetitorSpy /></div>
          <div className={page === 'insights'    ? '' : 'hidden'}><AIInsights /></div>
          <div className={page === 'alerts'      ? '' : 'hidden'}><AlertSettings /></div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <BottomNav active={page} onNavigate={setPage} />
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
