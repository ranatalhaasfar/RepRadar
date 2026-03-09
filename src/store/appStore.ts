import { create } from 'zustand'
import type { Business, Review } from '../lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type Insight = {
  id:             number
  icon:           string
  category:       string
  title:          string
  description:    string
  recommendation: string
  impact:         'High' | 'Medium' | 'Low'
}

export type SentimentPoint = { date: string; positive: number; negative: number }

export type DashboardStats = {
  positiveCount: number
  negativeCount: number
  neutralCount:  number
  reputationScore: number
}

export type Category = {
  id?:              string   // uuid from DB (absent when freshly generated)
  name:             string
  emoji:            string
  review_count:     number
  sentiment_score:  number   // –1 to 1
  verdict:          'Strength' | 'Needs Improvement' | 'Critical Issue'
  example_snippets: string[]
  reviewIndices:    number[] // 0-based indices into the reviews array
}

// ── Store shape ───────────────────────────────────────────────────────────────

type AppStore = {
  // ── Active business (global) ──
  activeBusinessId:  string | null
  activeBusiness:    Business | null
  allBusinesses:     Business[]

  // ── Insights ──
  insights:           Insight[]
  insightsLoadedAt:   number | null   // epoch ms
  insightsBusinessId: string | null   // which business these insights belong to

  // ── Dashboard ──
  business:             Business | null
  reviews:              Review[]
  dashboardLoadedAt:    number | null  // epoch ms
  dashboardBusinessId:  string | null  // which business this data belongs to

  // ── Categories ──
  categories:            Category[]
  categoriesLoadedAt:    number | null  // epoch ms
  categoriesBusinessId:  string | null  // which business these categories belong to

  // ── Navigation intent ──
  pendingReviewText:  string | null  // pre-fill ReviewResponder
  pendingNavPage:     string | null  // navigate to this page after mount

  // ── Actions ──
  setActiveBusiness:    (business: Business) => void
  setAllBusinesses:     (businesses: Business[]) => void
  setInsights:          (insights: Insight[], businessId: string) => void
  clearInsights:        () => void
  setDashboard:         (business: Business, reviews: Review[], businessId: string) => void
  clearDashboard:       () => void
  setCategories:        (categories: Category[], businessId: string) => void
  clearCategories:      () => void
  setPendingReviewText: (text: string | null) => void
  setPendingNavPage:    (page: string | null) => void
  clearAll:             () => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>((set) => ({
  // ── Initial state ──
  activeBusinessId:    null,
  activeBusiness:      null,
  allBusinesses:       [],

  insights:            [],
  insightsLoadedAt:    null,
  insightsBusinessId:  null,

  business:            null,
  reviews:             [],
  dashboardLoadedAt:   null,
  dashboardBusinessId: null,

  categories:            [],
  categoriesLoadedAt:    null,
  categoriesBusinessId:  null,

  pendingReviewText:   null,
  pendingNavPage:      null,

  // ── Actions ──
  setActiveBusiness: (business) => set({ activeBusinessId: business.id, activeBusiness: business }),

  setAllBusinesses: (businesses) => set({ allBusinesses: businesses }),

  setInsights: (insights, businessId) => set({
    insights,
    insightsLoadedAt:   Date.now(),
    insightsBusinessId: businessId,
  }),

  clearInsights: () => set({
    insights:           [],
    insightsLoadedAt:   null,
    insightsBusinessId: null,
  }),

  setDashboard: (business, reviews, businessId) => set({
    business,
    reviews,
    dashboardLoadedAt:   Date.now(),
    dashboardBusinessId: businessId,
  }),

  clearDashboard: () => set({
    business:            null,
    reviews:             [],
    dashboardLoadedAt:   null,
    dashboardBusinessId: null,
  }),

  setCategories: (categories, businessId) => set({
    categories,
    categoriesLoadedAt:   Date.now(),
    categoriesBusinessId: businessId,
  }),

  clearCategories: () => set({
    categories:            [],
    categoriesLoadedAt:    null,
    categoriesBusinessId:  null,
  }),

  setPendingReviewText: (text) => set({ pendingReviewText: text }),

  setPendingNavPage: (page) => set({ pendingNavPage: page }),

  clearAll: () => set({
    activeBusinessId:      null,
    activeBusiness:        null,
    allBusinesses:         [],
    insights:              [],
    insightsLoadedAt:      null,
    insightsBusinessId:    null,
    business:              null,
    reviews:               [],
    dashboardLoadedAt:     null,
    dashboardBusinessId:   null,
    categories:            [],
    categoriesLoadedAt:    null,
    categoriesBusinessId:  null,
    pendingReviewText:     null,
    pendingNavPage:        null,
  }),
}))
