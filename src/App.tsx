import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { useAppStore } from './store/appStore'
import { lcClearAll } from './lib/localCache'
import { supabase } from './lib/supabase'
import type { Business } from './lib/supabase'
import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import ForgotPassword from './pages/auth/ForgotPassword'
import Onboarding from './pages/Onboarding'
import AddBusiness from './pages/AddBusiness'
import Dashboard from './pages/Dashboard'
import ReviewResponder from './pages/ReviewResponder'
import CompetitorSpy from './pages/CompetitorSpy'
import AIInsights from './pages/AIInsights'
import Intelligence from './pages/Intelligence'
import AlertSettings from './pages/AlertSettings'

// ── Admin ──────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'pajamapoems00@gmail.com'

const isAdmin = (email: string | null | undefined): boolean =>
  email === ADMIN_EMAIL

// ── Types ──────────────────────────────────────────────────────────────────

type Page     = 'dashboard' | 'responder' | 'competitors' | 'insights' | 'intelligence' | 'alerts'
type AuthPage = 'login' | 'signup' | 'forgot'

type NavItem = {
  id: Page
  label: string
  icon: string
  badge?: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',    label: 'Dashboard',       icon: '📊' },
  { id: 'responder',    label: 'Responder',        icon: '✍️' },
  { id: 'competitors',  label: 'Competitors',      icon: '🔍' },
  { id: 'insights',     label: 'AI Insights',      icon: '🧠', badge: 'AI' },
  { id: 'intelligence', label: 'Intelligence',     icon: '🎯', badge: 'NEW' },
  { id: 'alerts',       label: 'Alerts',           icon: '🔔' },
]

const PAGE_TITLES: Record<Page, string> = {
  dashboard:    'Dashboard',
  responder:    'Review Responder',
  competitors:  'Competitor Spy',
  insights:     'AI Insights',
  intelligence: 'Intelligence',
  alerts:       'Alert Settings',
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  active,
  onNavigate,
  allBusinesses,
  activeBusiness,
  onSwitchBusiness,
  onAddBusiness,
  onDeleteBusiness,
  userEmail,
  userIsAdmin,
  onSignOut,
  onClose,
}: {
  active: Page
  onNavigate: (p: Page) => void
  allBusinesses: Business[]
  activeBusiness: Business | null
  onSwitchBusiness: (biz: Business) => void
  onAddBusiness: () => void
  onDeleteBusiness: (biz: Business) => void
  userEmail: string
  userIsAdmin: boolean
  onSignOut: () => void
  onClose?: () => void
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false)

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

      {/* Footer — business switcher + sign out */}
      <div className="px-3 py-3 border-t border-[#1e2d4a]">

        {/* Switcher trigger */}
        <button
          onClick={() => setSwitcherOpen(o => !o)}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors mb-1"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(activeBusiness?.name || userEmail)[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-gray-300 truncate">{activeBusiness?.name ?? 'My Business'}</p>
              {userIsAdmin && (
                <span className="shrink-0 text-[9px] font-bold px-1.5 py-px rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  ADMIN
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-600 truncate">{userEmail}</p>
          </div>
          <svg
            className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform duration-200 ${switcherOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown */}
        {switcherOpen && (
          <div className="mb-2 bg-[#080d1a] border border-[#1e2d4a] rounded-xl overflow-hidden">
            {allBusinesses.map(biz => (
              <div
                key={biz.id}
                className={`group flex items-center gap-2.5 px-3 py-2.5 transition-colors ${
                  biz.id === activeBusiness?.id
                    ? 'bg-purple-600/15 text-purple-300'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
              >
                <button
                  onClick={() => { onSwitchBusiness(biz); setSwitcherOpen(false); onClose?.() }}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                >
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                    {biz.name[0]?.toUpperCase() ?? 'B'}
                  </div>
                  <span className="text-xs truncate flex-1">{biz.name}</span>
                  {biz.id === activeBusiness?.id && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />}
                </button>
                {allBusinesses.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteBusiness(biz) }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                    title="Delete business"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => { setSwitcherOpen(false); onClose?.(); onAddBusiness() }}
              className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-[#1e2d4a] text-gray-500 hover:text-purple-400 hover:bg-purple-500/5 transition-colors"
            >
              <span className="text-base font-light leading-none">+</span>
              <span className="text-xs">Add Business</span>
            </button>
          </div>
        )}

        {/* Sign out */}
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
  const clearAll          = useAppStore(s => s.clearAll)
  const setActiveBusiness = useAppStore(s => s.setActiveBusiness)
  const setAllBusinesses  = useAppStore(s => s.setAllBusinesses)
  const activeBusiness      = useAppStore(s => s.activeBusiness)
  const allBusinesses       = useAppStore(s => s.allBusinesses)
  const pendingNavPage      = useAppStore(s => s.pendingNavPage)
  const setPendingNavPage   = useAppStore(s => s.setPendingNavPage)
  const showUpgradeModal    = useAppStore(s => s.showUpgradeModal)
  const setShowUpgradeModal = useAppStore(s => s.setShowUpgradeModal)

  const [page, setPage]               = useState<Page>('dashboard')
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null)
  const [addingBusiness, setAddingBusiness]   = useState(false)
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [bizToDelete, setBizToDelete]   = useState<Business | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const [toast, setToast]               = useState<string | null>(null)

  // ── Load all businesses on mount ─────────────────────────────────────────

  useEffect(() => {
    if (!user) return
    loadAllBusinesses()
  }, [user])

  // ── Cross-page navigation intent ─────────────────────────────────────────

  useEffect(() => {
    if (pendingNavPage && pendingNavPage in PAGE_TITLES) {
      setPage(pendingNavPage as Page)
      setPendingNavPage(null)
    }
  }, [pendingNavPage])

  const loadAllBusinesses = async () => {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: true })
    const list: Business[] = (data ?? []) as Business[]
    setAllBusinesses(list)
    setHasOnboarded(list.length > 0)
    if (list.length > 0 && !activeBusiness) setActiveBusiness(list[0])
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSignOut = () => {
    clearAll()
    lcClearAll()
    signOut()
  }

  const handleOnboardingComplete = async () => {
    await loadAllBusinesses()
    setHasOnboarded(true)
  }

  const handleAddBusinessComplete = async (newBiz: Business) => {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: true })
    const list: Business[] = (data ?? []) as Business[]
    clearAll()
    setAllBusinesses(list)
    setActiveBusiness(newBiz)
    setAddingBusiness(false)
  }

  const handleSwitchBusiness = (biz: Business) => {
    if (biz.id === activeBusiness?.id) return
    const snapshot = allBusinesses
    clearAll()
    setAllBusinesses(snapshot)
    setActiveBusiness(biz)
    setPage('dashboard')
  }

  const handleAddBusinessClick = () => {
    const FREE_LIMIT = 1
    if (!isAdmin(user?.email) && allBusinesses.length >= FREE_LIMIT) {
      setShowUpgradeModal(true)
    } else {
      setAddingBusiness(true)
    }
  }

  const confirmDeleteBusiness = async () => {
    if (!bizToDelete) return
    setDeleting(true)
    try {
      const id = bizToDelete.id
      await supabase.from('reviews').delete().eq('business_id', id)
      await supabase.from('insights').delete().eq('business_id', id)
      await supabase.from('competitors').delete().eq('business_id', id)
      await supabase.from('categories').delete().eq('business_id', id)
      await supabase.from('product_insights').delete().eq('business_id', id)
      await supabase.from('businesses').delete().eq('id', id)

      // Clear localStorage for this business
      const namespaces = ['dashboard', 'reviews', 'insights', 'competitors', 'categories']
      namespaces.forEach(ns => {
        try { localStorage.removeItem(`repradar_${ns}_${id}`) } catch {}
      })

      // Reload business list and switch
      const { data } = await supabase
        .from('businesses').select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true })
      const list: Business[] = (data ?? []) as Business[]
      clearAll()
      setAllBusinesses(list)
      if (list.length > 0) setActiveBusiness(list[0])
      setHasOnboarded(list.length > 0)
      setBizToDelete(null)
      setToast('Business deleted successfully')
      setTimeout(() => setToast(null), 3500)
    } finally {
      setDeleting(false)
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────

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

  // ── Add Business inline flow ──────────────────────────────────────────────

  if (addingBusiness) {
    return (
      <div className="min-h-screen bg-[#080d1a]">
        <div className="lg:ml-60 flex flex-col min-h-screen">
          <TopBar page={page} onMenuOpen={() => {}} />
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            <AddBusiness
              onComplete={handleAddBusinessComplete}
              onCancel={() => setAddingBusiness(false)}
            />
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#080d1a]">

      {/* ── Desktop sidebar (always visible on lg+) ── */}
      <div className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30">
        <Sidebar
          active={page}
          onNavigate={setPage}
          allBusinesses={allBusinesses}
          activeBusiness={activeBusiness}
          onSwitchBusiness={handleSwitchBusiness}
          onAddBusiness={handleAddBusinessClick}
          onDeleteBusiness={setBizToDelete}
          userEmail={user?.email ?? ''}
          userIsAdmin={isAdmin(user?.email)}
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
              allBusinesses={allBusinesses}
              activeBusiness={activeBusiness}
              onSwitchBusiness={handleSwitchBusiness}
              onAddBusiness={handleAddBusinessClick}
              onDeleteBusiness={setBizToDelete}
              userEmail={user?.email ?? ''}
              userIsAdmin={isAdmin(user?.email)}
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
          <div className={page === 'insights'      ? '' : 'hidden'}><AIInsights /></div>
          <div className={page === 'intelligence' ? '' : 'hidden'}><Intelligence /></div>
          <div className={page === 'alerts'       ? '' : 'hidden'}><AlertSettings /></div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <BottomNav active={page} onNavigate={setPage} />

      {/* ── Upgrade modal ── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#0f1123] border border-[#2a2d4a] rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
            <p className="text-5xl">🔒</p>
            <h2 className="text-xl font-bold text-gray-100">Upgrade to Unlock</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              This feature requires a paid plan. Get access to AI insights, review fetching, competitor analysis, and more.
            </p>
            <div className="space-y-3 text-left">
              <div className="bg-[#1a1d33] border border-purple-500/40 rounded-xl p-4">
                <p className="font-semibold text-gray-100 text-sm">Starter — $29/month</p>
                <p className="text-xs text-gray-500 mt-1">1 business · All features</p>
              </div>
              <div className="bg-[#1a1d33] border border-[#2a2d4a] rounded-xl p-4">
                <p className="font-semibold text-gray-100 text-sm">Pro — $49/month</p>
                <p className="text-xs text-gray-500 mt-1">3 businesses · Priority support</p>
              </div>
            </div>
            <button
              onClick={() => window.open('mailto:pajamapoems00@gmail.com?subject=RepRadar Upgrade Request', '_blank')}
              className="btn-primary w-full px-6 py-3 text-sm font-semibold"
            >
              Get Started →
            </button>
            <button
              onClick={() => setShowUpgradeModal(false)}
              className="text-sm text-gray-600 hover:text-gray-400 transition-colors block w-full"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* ── Delete business confirmation modal ── */}
      {bizToDelete && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f1629] border border-[#1e2d4a] rounded-2xl p-8 max-w-sm w-full space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-100 leading-snug">
                  Delete "{bizToDelete.name}"?
                </h2>
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                  This will permanently delete all reviews, insights and competitor data for this business. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBizToDelete(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-300 bg-[#080d1a] border border-[#1e2d4a] rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBusiness}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Deleting…
                  </>
                ) : 'Delete Business'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-2.5 bg-[#0f1629] border border-emerald-500/40 text-emerald-300 text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg shadow-black/40">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {toast}
          </div>
        </div>
      )}
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
