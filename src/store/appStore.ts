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

// ── Store shape ───────────────────────────────────────────────────────────────

type AppStore = {
  // ── Insights ──
  insights:           Insight[]
  insightsLoadedAt:   number | null   // epoch ms
  insightsBusinessId: string | null   // which business these insights belong to

  // ── Dashboard ──
  business:             Business | null
  reviews:              Review[]
  dashboardLoadedAt:    number | null  // epoch ms
  dashboardBusinessId:  string | null  // which business this data belongs to

  // ── Actions ──
  setInsights:     (insights: Insight[], businessId: string) => void
  clearInsights:   () => void
  setDashboard:    (business: Business, reviews: Review[], businessId: string) => void
  clearDashboard:  () => void
  clearAll:        () => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>((set) => ({
  // ── Initial state ──
  insights:            [],
  insightsLoadedAt:    null,
  insightsBusinessId:  null,

  business:            null,
  reviews:             [],
  dashboardLoadedAt:   null,
  dashboardBusinessId: null,

  // ── Actions ──
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

  clearAll: () => set({
    insights:            [],
    insightsLoadedAt:    null,
    insightsBusinessId:  null,
    business:            null,
    reviews:             [],
    dashboardLoadedAt:   null,
    dashboardBusinessId: null,
  }),
}))
