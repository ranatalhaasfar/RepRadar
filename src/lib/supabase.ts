import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── Database types ──────────────────────────────────────────────────────────

export type Business = {
  id: string
  user_id: string
  name: string
  type: string
  location: string
  place_id: string | null           // Outscraper/Google place_id
  full_address: string | null       // Full address from Outscraper
  google_rating: number | null      // Live Google rating
  total_reviews: number
  reputation_score: number | null   // AI-computed score (0–100)
  keywords: string[] | null         // Cached top keywords
  analyzed_at: string | null        // Last Anthropic analysis timestamp
  reviews_fetched_at: string | null // Last Outscraper fetch timestamp
  created_at: string
}

export type Review = {
  id: string
  business_id: string
  user_id: string
  review_text: string
  reviewer_name: string
  rating: number | null             // 1–5 star rating from Google
  sentiment: 'positive' | 'negative' | 'neutral' | null
  reviewed_at: string | null        // Original review date from Google
  created_at: string
}

export type Competitor = {
  id: string
  business_id: string
  name: string
  location: string
  place_id: string | null
  full_address: string | null
  google_rating: number | null
  total_reviews: number | null
  reviews_fetched_at: string | null
  created_at: string
}
