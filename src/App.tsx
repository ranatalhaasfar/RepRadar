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
import {
  LayoutDashboard, MessageSquareReply, Search, Lightbulb, Eye, Bell,
  Radar, LogOut, ChevronDown, Menu, X, Plus, Trash2, Lock, Check,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ── Admin ──────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'pajamapoems00@gmail.com'
const isAdmin = (email: string | null | undefined): boolean => email === ADMIN_EMAIL

// ── Types ──────────────────────────────────────────────────────────────────

type Page     = 'dashboard' | 'responder' | 'competitors' | 'insights' | 'intelligence' | 'alerts'
type AuthPage = 'login' | 'signup' | 'forgot'

type NavItem = { id: Page; label: string; icon: LucideIcon; badge?: string }

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { id: 'responder',    label: 'Responder',    icon: MessageSquareReply },
  { id: 'competitors',  label: 'Competitors',  icon: Search },
  { id: 'insights',     label: 'AI Insights',  icon: Lightbulb,  badge: 'AI' },
  { id: 'intelligence', label: 'Intelligence', icon: Eye,         badge: 'NEW' },
  { id: 'alerts',       label: 'Alerts',       icon: Bell },
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
  active, onNavigate, allBusinesses, activeBusiness,
  onSwitchBusiness, onAddBusiness, onDeleteBusiness,
  userEmail, userIsAdmin, onSignOut, onClose,
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

  const handleNav = (p: Page) => { onNavigate(p); onClose?.() }

  return (
    <aside className="flex flex-col h-full border-r border-white/5" style={{ background: 'rgba(24,30,38,0.92)', backdropFilter: 'blur(30px)' }}>

      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-[14px] bg-gradient-to-r from-emerald-400 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg" style={{ boxShadow: '0 4px 16px rgba(16,185,129,0.25)' }}>
            <Radar size={20} className="text-white" />
          </div>
          <div>
            <p className="text-[18px] font-bold text-white tracking-tight leading-none">RepRadar</p>
            <p className="text-[11px] text-white/30 leading-tight mt-0.5">Reputation Intelligence</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden p-1.5 text-white/40 hover:text-white/80 hover:bg-white/[0.06] rounded-lg transition-colors">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const isActive = active === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
                isActive
                  ? 'bg-emerald-500/15 text-white border border-emerald-500/20'
                  : 'text-white/40 hover:text-white/80 hover:bg-white/[0.06] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`transition-colors ${isActive ? 'text-emerald-400' : 'text-white/40 group-hover:text-white/70'}`}>
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                  item.badge === 'AI'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-white/50'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/5">

        {/* Business switcher trigger */}
        <button
          onClick={() => setSwitcherOpen(o => !o)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/[0.06] transition-colors mb-1"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(activeBusiness?.name || userEmail)[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-white/60 truncate">{activeBusiness?.name ?? 'My Business'}</p>
              {userIsAdmin && (
                <span className="shrink-0 text-[11px] font-bold px-1.5 py-px rounded-full bg-amber-400/20 text-amber-300">
                  ADMIN
                </span>
              )}
            </div>
            <p className="text-[11px] text-white/30 truncate">{userEmail}</p>
          </div>
          <ChevronDown
            size={14}
            className={`text-white/40 shrink-0 transition-transform duration-200 ${switcherOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Dropdown */}
        {switcherOpen && (
          <div className="mb-2 bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-glass">
            {allBusinesses.map(biz => (
              <div
                key={biz.id}
                className={`group flex items-center gap-2.5 px-3 py-2.5 transition-colors ${
                  biz.id === activeBusiness?.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/[0.06] hover:text-white/90'
                }`}
              >
                <button
                  onClick={() => { onSwitchBusiness(biz); setSwitcherOpen(false); onClose?.() }}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                    {biz.name[0]?.toUpperCase() ?? 'B'}
                  </div>
                  <span className="text-xs truncate flex-1 font-medium">{biz.name}</span>
                  {biz.id === activeBusiness?.id && <Check size={12} className="text-emerald-400 shrink-0" />}
                </button>
                {allBusinesses.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteBusiness(biz) }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                    title="Delete business"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => { setSwitcherOpen(false); onClose?.(); onAddBusiness() }}
              className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-white/5 text-white/40 hover:text-emerald-400 hover:bg-white/[0.06] transition-colors"
            >
              <Plus size={14} />
              <span className="text-xs font-medium">Add Business</span>
            </button>
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all min-h-[44px]"
        >
          <LogOut size={14} />
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
    <header className="h-14 flex items-center justify-between px-4 sticky top-0 z-20 border-b border-black/5" style={{ background: 'rgba(244,243,239,0.85)', backdropFilter: 'blur(20px)' }}>
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuOpen}
          className="lg:hidden p-2 text-black/40 hover:text-black/60 hover:bg-black/[0.03] rounded-lg transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <h2 className="text-[22px] font-bold text-black/80">{PAGE_TITLES[page]}</h2>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-[12px] text-black/25 hidden sm:block">{dateStr}</span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[12px] text-black/30 font-medium">Monitoring</span>
        </div>
      </div>
    </header>
  )
}

// ── BottomNav — mobile only ────────────────────────────────────────────────

function BottomNav({ active, onNavigate }: { active: Page; onNavigate: (p: Page) => void }) {
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-black/5" style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)' }}>
      {NAV_ITEMS.map(item => {
        const isActive = active === item.id
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] transition-colors relative ${
              isActive ? 'text-emerald-500' : 'text-black/25 hover:text-black/40'
            }`}
          >
            {isActive && (
              <span className="absolute top-0 inset-x-0 h-0.5 bg-emerald-500 rounded-b" />
            )}
            <Icon size={16} strokeWidth={1.75} />
            <span className="text-[11px] font-medium leading-none mt-0.5">{item.label}</span>
            {item.badge && (
              <span className="absolute top-1.5 right-1/2 translate-x-3 text-[11px] font-bold px-1 py-px rounded-full bg-emerald-500/15 text-emerald-500">
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

  useEffect(() => {
    if (!user) return
    loadAllBusinesses()
  }, [user])

  useEffect(() => {
    if (pendingNavPage && pendingNavPage in PAGE_TITLES) {
      setPage(pendingNavPage as Page)
      setPendingNavPage(null)
    }
  }, [pendingNavPage])

  const loadAllBusinesses = async () => {
    const { data } = await supabase
      .from('businesses').select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: true })
    const list: Business[] = (data ?? []) as Business[]
    setAllBusinesses(list)
    setHasOnboarded(list.length > 0)
    if (list.length > 0 && !activeBusiness) setActiveBusiness(list[0])
  }

  const handleSignOut = () => { clearAll(); lcClearAll(); signOut() }

  const handleOnboardingComplete = async () => { await loadAllBusinesses(); setHasOnboarded(true) }

  const handleAddBusinessComplete = async (newBiz: Business) => {
    const { data } = await supabase
      .from('businesses').select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: true })
    const list: Business[] = (data ?? []) as Business[]
    clearAll(); setAllBusinesses(list); setActiveBusiness(newBiz); setAddingBusiness(false)
  }

  const handleSwitchBusiness = (biz: Business) => {
    if (biz.id === activeBusiness?.id) return
    const snapshot = allBusinesses
    clearAll(); setAllBusinesses(snapshot); setActiveBusiness(biz); setPage('dashboard')
  }

  const handleAddBusinessClick = () => {
    if (!isAdmin(user?.email) && allBusinesses.length >= 1) {
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

      const namespaces = ['dashboard', 'reviews', 'insights', 'competitors', 'categories']
      namespaces.forEach(ns => {
        try { localStorage.removeItem(`repradar_${ns}_${id}`) } catch {}
      })

      const { data } = await supabase
        .from('businesses').select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true })
      const list: Business[] = (data ?? []) as Business[]
      clearAll(); setAllBusinesses(list)
      if (list.length > 0) setActiveBusiness(list[0])
      setHasOnboarded(list.length > 0)
      setBizToDelete(null)
      setToast('Business deleted successfully')
      setTimeout(() => setToast(null), 3500)
    } finally {
      setDeleting(false)
    }
  }

  if (hasOnboarded === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(145deg, #E8F0EC, #EBE8E4)'}}>
        <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasOnboarded) return <Onboarding onComplete={handleOnboardingComplete} />

  if (addingBusiness) {
    return (
      <div className="min-h-screen" style={{ background: 'linear-gradient(145deg, #E8F0EC 0%, #E2EBE5 20%, #E6E8EB 40%, #EDE5E0 60%, #F0EDE8 80%, #EBE8E4 100%)' }}>
        <div className="lg:ml-60 flex flex-col min-h-screen">
          <TopBar page={page} onMenuOpen={() => {}} />
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            <AddBusiness onComplete={handleAddBusinessComplete} onCancel={() => setAddingBusiness(false)} />
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(145deg, #E8F0EC 0%, #E2EBE5 20%, #E6E8EB 40%, #EDE5E0 60%, #F0EDE8 80%, #EBE8E4 100%)' }}>

      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 z-0" style={{
        backgroundImage: `radial-gradient(circle at 80% 10%, rgba(52,211,153,0.15) 0%, transparent 65%), radial-gradient(circle at 30% 90%, rgba(96,165,250,0.1) 0%, transparent 60%)`
      }} />

      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30">
        <Sidebar
          active={page} onNavigate={setPage}
          allBusinesses={allBusinesses} activeBusiness={activeBusiness}
          onSwitchBusiness={handleSwitchBusiness} onAddBusiness={handleAddBusinessClick}
          onDeleteBusiness={setBizToDelete}
          userEmail={user?.email ?? ''} userIsAdmin={isAdmin(user?.email)}
          onSignOut={handleSignOut}
        />
      </div>

      {/* ── Mobile overlay sidebar ── */}
      {sidebarOpen && (
        <>
          <div className="lg:hidden fixed inset-0 bg-black/30 z-40 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="lg:hidden fixed inset-y-0 left-0 w-72 z-50">
            <Sidebar
              active={page} onNavigate={setPage}
              allBusinesses={allBusinesses} activeBusiness={activeBusiness}
              onSwitchBusiness={handleSwitchBusiness} onAddBusiness={handleAddBusinessClick}
              onDeleteBusiness={setBizToDelete}
              userEmail={user?.email ?? ''} userIsAdmin={isAdmin(user?.email)}
              onSignOut={handleSignOut} onClose={() => setSidebarOpen(false)}
            />
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <div className="lg:ml-60 flex flex-col min-h-screen">
        <TopBar page={page} onMenuOpen={() => setSidebarOpen(true)} />
        <main className="relative z-10 flex-1 p-4 md:p-6 overflow-auto pb-20 lg:pb-6">
          <div className={page === 'dashboard'    ? '' : 'hidden'}><Dashboard /></div>
          <div className={page === 'responder'    ? '' : 'hidden'}><ReviewResponder /></div>
          <div className={page === 'competitors'  ? '' : 'hidden'}><CompetitorSpy /></div>
          <div className={page === 'insights'     ? '' : 'hidden'}><AIInsights /></div>
          <div className={page === 'intelligence' ? '' : 'hidden'}><Intelligence /></div>
          <div className={page === 'alerts'       ? '' : 'hidden'}><AlertSettings /></div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <BottomNav active={page} onNavigate={setPage} />

      {/* ── Upgrade modal ── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white/80 backdrop-blur-2xl border border-white/80 rounded-[24px] p-8 max-w-sm w-full text-center space-y-5 shadow-glass-lg">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
              <Lock size={24} className="text-emerald-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-black/80">Upgrade to Unlock</h2>
              <p className="text-sm text-black/45 leading-relaxed mt-1">
                Get access to AI insights, review fetching, competitor analysis, and more.
              </p>
            </div>
            <div className="space-y-2.5 text-left">
              <div className="glass-card-inner p-4">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="font-bold text-black/80 text-sm">Starter</p>
                  <p className="font-bold text-emerald-600 text-sm">$29<span className="text-xs font-normal text-black/35">/mo</span></p>
                </div>
                <p className="text-xs text-black/45">1 business - All features included</p>
                <div className="mt-2 space-y-1">
                  {['AI review analysis', 'Competitor tracking', 'Intelligence reports'].map(f => (
                    <div key={f} className="flex items-center gap-1.5 text-xs text-black/55">
                      <Check size={14} className="text-emerald-500" />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-card-inner p-4">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="font-bold text-black/80 text-sm">Pro</p>
                  <p className="font-bold text-black/60 text-sm">$49<span className="text-xs font-normal text-black/35">/mo</span></p>
                </div>
                <p className="text-xs text-black/45">3 businesses - Priority support</p>
              </div>
            </div>
            <button
              onClick={() => window.open('mailto:pajamapoems00@gmail.com?subject=RepRadar Upgrade Request', '_blank')}
              className="btn-primary w-full px-6 py-3 text-sm"
            >
              Get Started
            </button>
            <button
              onClick={() => setShowUpgradeModal(false)}
              className="text-sm text-black/30 hover:text-black/50 transition-colors block w-full"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* ── Delete business confirmation modal ── */}
      {bizToDelete && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white/80 backdrop-blur-2xl border border-white/80 rounded-[24px] p-7 max-w-sm w-full space-y-5 shadow-glass-lg">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center shrink-0">
                <Trash2 size={20} className="text-rose-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-black/80 leading-snug">Delete &ldquo;{bizToDelete.name}&rdquo;?</h2>
                <p className="text-xs text-black/45 mt-1.5 leading-relaxed">
                  This permanently deletes all reviews, insights and competitor data. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBizToDelete(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-black/60 bg-black/[0.04] border border-black/10 hover:bg-black/[0.06] rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBusiness}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-2.5 bg-white/80 backdrop-blur-xl border border-white/60 text-black/70 text-xs font-medium px-4 py-2.5 rounded-xl shadow-glass">
            <Check size={16} className="text-emerald-500 shrink-0" />
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
  if (authPage === 'signup') return <Signup onSwitch={setAuthPage} />
  if (authPage === 'forgot') return <ForgotPassword onSwitch={setAuthPage} />
  return <Login onSwitch={setAuthPage} />
}

// ── Root router ────────────────────────────────────────────────────────────

function Root() {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{background: 'linear-gradient(145deg, #E8F0EC, #EBE8E4)'}}>
        <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    )
  }
  return session ? <AuthenticatedApp /> : <UnauthenticatedApp />
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}
