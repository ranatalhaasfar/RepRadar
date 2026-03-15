import { getClient, getSupabase } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { businessName, businessType, reviews, business_id, user_id } = req.body;

  try {
    // Use passed reviews, or fall back to fetching from DB if empty
    let reviewData = Array.isArray(reviews) && reviews.length > 0 ? reviews : [];
    if (reviewData.length === 0 && business_id) {
      const supabase = getSupabase();
      if (supabase) {
        const { data: dbReviews } = await supabase
          .from('reviews')
          .select('review_text, rating')
          .eq('business_id', business_id)
          .order('reviewed_at', { ascending: false })
          .limit(200);
        reviewData = dbReviews ?? [];
        console.log(`[generate-insights] fetched ${reviewData.length} reviews from DB (none passed by client)`);
      }
    }

    if (reviewData.length === 0) {
      return res.status(422).json({ error: 'No reviews found for this business' });
    }

    // Normalise: accept both string[] (legacy) and {review_text, rating}[] (current)
    const normalised = reviewData.map(r =>
      typeof r === 'string'
        ? { review_text: r, rating: null }
        : { review_text: r.review_text ?? '', rating: r.rating ?? null }
    );

    // Representative sample: negatives for problem detection, positives to surface wins
    const negative = normalised.filter(r => r.rating !== null && r.rating <= 2).slice(0, 30);
    const neutral  = normalised.filter(r => r.rating === 3).slice(0, 15);
    const positive = normalised.filter(r => r.rating !== null && r.rating >= 4).slice(0, 35);
    let balanced = [...negative, ...neutral, ...positive];

    // Fallback: if all ratings are null, use all reviews
    if (balanced.length === 0) {
      balanced = normalised.slice(0, 80);
    }

    console.log(`[generate-insights] sample: ${negative.length} negative, ${neutral.length} neutral, ${positive.length} positive = ${balanced.length} total (from ${normalised.length} reviews)`);

    const sample = balanced
      .map(r => {
        const text = typeof r.review_text === 'string' ? r.review_text : '';
        return `[${r.rating ?? '?'}★] ${text.substring(0, 120)}`;
      })
      .join('\n');

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'You are a business intelligence engine. Return only valid JSON — no markdown, no explanation, no code fences.',
      messages: [{
        role: 'user',
        content:
          `You are analyzing ${balanced.length} customer reviews for "${businessName}", a ${businessType}.\n` +
          `Each review is prefixed with its star rating.\n\n` +
          `Generate 6-8 specific, evidence-based insights that cover both strengths and weaknesses:\n` +
          `- For things customers love: use category "Winning", icon 🏆, and quantify ("mentioned in 23 reviews", "praised by 60% of customers")\n` +
          `- For recurring problems: use the most relevant category, icon ⚠️\n` +
          `- For growth opportunities: use category "Opportunity", icon 🚀\n\n` +
          `Every insight must reference actual patterns from the reviews with specific counts or percentages. No generic advice.\n\n` +
          `Return a JSON object with this exact shape:\n` +
          `{\n` +
          `  "insights": [\n` +
          `    {\n` +
          `      "icon": "<single emoji>",\n` +
          `      "category": "<one of: Winning|Service|Food|Pricing|Ambiance|Opportunity>",\n` +
          `      "title": "<concise headline, 60 chars max>",\n` +
          `      "description": "<2 sentences citing the pattern and how many reviews mention it>",\n` +
          `      "recommendation": "<specific actionable advice for this business type, 2-3 sentences>",\n` +
          `      "impact": "<High|Medium|Low>"\n` +
          `    }\n` +
          `  ]\n` +
          `}\n\n` +
          `Reviews:\n${sample}`,
      }],
    });

    const data = extractJSONObject(response.content[0].type === 'text' ? response.content[0].text : '')

    // Persist to Supabase so data survives browser clears and other devices
    if (business_id && Array.isArray(data.insights) && data.insights.length > 0) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          await supabase.from('insights').delete().eq('business_id', business_id);
          const now = new Date().toISOString();
          const rows = data.insights.map(ins => ({
            business_id,
            user_id: user_id ?? null,
            icon: ins.icon, category: ins.category, title: ins.title,
            description: ins.description, recommendation: ins.recommendation,
            impact: ins.impact, created_at: now,
          }));
          const { error: insertErr } = await supabase.from('insights').insert(rows);
          if (insertErr) console.error('[generate-insights] DB insert error:', insertErr.message);
          else console.log('[generate-insights] saved', rows.length, 'insights to Supabase');
        } catch (e) {
          console.error('[generate-insights] DB save failed:', e.message);
        }
      }
    }

    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-insights]', message);
    res.status(500).json({ error: message });
  }
}
