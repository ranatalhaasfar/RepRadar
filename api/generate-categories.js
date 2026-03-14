import { getClient, getSupabase } from './_lib/shared.js';
import { extractJSON } from './utils/extractJSON.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reviews, business_id } = req.body;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'reviews array is required.' });
  }

  try {
    // Hard cache check — return existing Supabase categories if available
    if (business_id) {
      const supabase = getSupabase();
      if (supabase) {
        const { data: cached } = await supabase
          .from('categories')
          .select('*')
          .eq('business_id', business_id)
          .order('review_count', { ascending: false });
        if (cached && cached.length > 0) {
          console.log('[/api/generate-categories] cache hit for', business_id);
          const categories = cached.map(row => ({ ...row, reviewIndices: row.review_indices ?? [] }));
          return res.json({ categories, cached: true });
        }
      }
    }

    // ── Step 1: cheap AI call — sample 50 reviews, ask only for category shapes ──
    const sample = reviews
      .slice(0, 50)
      .map(r => (r.review_text || '').substring(0, 80))
      .join('\n');

    const client = getClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system:
        'You are a review analysis expert. Return ONLY a JSON array — no markdown, no explanation.',
      messages: [{
        role: 'user',
        content:
          `Analyze these customer reviews and identify 5–8 distinct categories relevant to this business.\n\n` +
          `Return ONLY a JSON array like:\n` +
          `[{"name":"Food Quality","emoji":"🍽️","verdict":"Strength","keywords":["food","taste","dish","delicious"]}]\n\n` +
          `Rules:\n` +
          `- "verdict" must be exactly one of: "Strength", "Needs Improvement", "Critical Issue"\n` +
          `- "keywords" must be 4–10 lowercase words/phrases customers use for this category\n` +
          `- Categories must reflect real patterns — do not invent generic ones\n\n` +
          `Reviews:\n${sample}`,
      }],
    });

    const aiCategories = extractJSON(message.content[0]?.text ?? '');
    if (!Array.isArray(aiCategories) || aiCategories.length === 0) {
      return res.status(500).json({ error: 'AI returned no categories' });
    }

    // ── Step 2: local keyword matching — free, covers all reviews ──
    const lowerReviews = reviews.map(r => (r.review_text || '').toLowerCase());

    const categories = aiCategories.map(cat => {
      const keywords = (cat.keywords || []).map(k => k.toLowerCase());

      const reviewIndices = lowerReviews
        .map((text, i) => ({ i, text }))
        .filter(({ text }) => keywords.some(kw => text.includes(kw)))
        .map(({ i }) => i);

      const matched = reviewIndices.map(i => reviews[i]);
      const positive = matched.filter(r => r.sentiment === 'positive').length;
      const negative = matched.filter(r => r.sentiment === 'negative').length;
      const sentimentScore = matched.length > 0
        ? parseFloat(((positive - negative) / matched.length).toFixed(2))
        : 0;

      const example_snippets = matched
        .slice(0, 3)
        .map(r => (r.review_text || '').substring(0, 80).trim())
        .filter(Boolean);

      return {
        name:             cat.name,
        emoji:            cat.emoji,
        verdict:          cat.verdict,
        review_count:     reviewIndices.length,
        sentiment_score:  sentimentScore,
        example_snippets,
        reviewIndices,
      };
    });

    // Sort by review_count descending
    categories.sort((a, b) => b.review_count - a.review_count);

    return res.json({ categories });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-categories]', message);
    res.status(500).json({ error: message });
  }
}
