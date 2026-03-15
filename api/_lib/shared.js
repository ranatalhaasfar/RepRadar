import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ── Lazy Anthropic client ──────────────────────────────────────────────────

let _client = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ── Lazy Supabase server client ────────────────────────────────────────────

let _supabase = null;
export function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null; // cache disabled if not configured
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// ── Plan access helpers ────────────────────────────────────────────────────

const ADMIN_EMAIL = 'pajamapoems00@gmail.com';

export function isAdminEmail(email) {
  return email === ADMIN_EMAIL;
}

export async function checkPlanAccess(supabase, userId) {
  if (!supabase || !userId) return { isAdmin: false, isPaid: false, plan: 'free', email: null };
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, email')
    .eq('id', userId)
    .single();
  const email = profile?.email ?? null;
  const plan  = profile?.plan  ?? 'free';
  const admin = isAdminEmail(email);
  return {
    isAdmin: admin,
    isPaid:  admin || plan === 'starter' || plan === 'pro' || plan === 'agency',
    plan,
    email,
  };
}

// ── Tone descriptions ──────────────────────────────────────────────────────

export const TONE_DESCRIPTIONS = {
  Friendly:     'warm, personable, and enthusiastic with a conversational tone that makes customers feel appreciated',
  Professional: 'polished, formal, and business-appropriate — respectful and composed',
  Apologetic:   "empathetic, sincere, and focused on understanding the customer's experience and making things right",
};

// ── Review extraction helpers ──────────────────────────────────────────────

export function mapReview(r) {
  return {
    reviewer_name: r.author_title ?? r.reviewer_name ?? r.name ?? 'Anonymous',
    review_text:   r.review_text ?? r.text ?? r.snippet ?? '',
    rating:        typeof r.review_rating === 'number' ? r.review_rating
                 : typeof r.rating === 'number'        ? r.rating
                 : null,
    reviewed_at:   r.review_datetime_utc ?? r.review_timestamp ?? r.date ?? null,
  };
}

export function extractReviews(dataArray) {
  // Outscraper occasionally includes URL strings or null entries — filter to objects only
  const flat = dataArray.flat().filter(item => item !== null && typeof item === 'object');
  if (flat.length === 0) { console.log('[extractReviews] dataArray is empty or all-non-object'); return []; }

  const first = flat[0];

  // Case 1: each item IS a review (has review_text directly)
  if (typeof first.review_text === 'string' || typeof first.text === 'string') {
    console.log(`[extractReviews] Case 1 — flat reviews, ${flat.length} items`);
    return flat.map(mapReview);
  }

  // Case 2: each item is a place with a .reviews array
  if (Array.isArray(first.reviews)) {
    const all = flat.flatMap(place => place.reviews.map(mapReview));
    console.log(`[extractReviews] Case 2 — nested .reviews[], ${all.length} reviews`);
    return all;
  }

  // Case 3: data is [[place, review, review, ...]]
  const inner = dataArray[0];
  if (Array.isArray(inner)) {
    const reviewItems = inner.filter(item => typeof item.review_text === 'string' || typeof item.text === 'string');
    if (reviewItems.length > 0) {
      console.log(`[extractReviews] Case 3 — inner array with ${reviewItems.length} review items`);
      return reviewItems.map(mapReview);
    }
  }

  // Case 4: scan all keys for arrays containing review-like objects
  const reviewKey = Object.keys(first).find(k =>
    Array.isArray(first[k]) && first[k].length > 0 &&
    typeof first[k][0] === 'object' && first[k][0] !== null &&
    ('review_text' in first[k][0] || 'text' in first[k][0] || 'author_title' in first[k][0])
  );
  if (reviewKey) {
    const all = flat.flatMap(place => (Array.isArray(place[reviewKey]) ? place[reviewKey] : []).map(mapReview));
    console.log(`[extractReviews] Case 4 — reviews at key "${reviewKey}", ${all.length} reviews`);
    return all;
  }

  console.log('[extractReviews] Could not find reviews. Keys on first item:', Object.keys(first).join(', '));
  return [];
}
