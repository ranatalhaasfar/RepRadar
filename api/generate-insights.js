import { getClient, getSupabase } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { businessName, businessType, reviews, business_id, user_id } = req.body;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'reviews array is required.' });
  }

  try {
    // Hard cache check — return existing insights from Supabase if available
    if (business_id) {
      const supabase = getSupabase();
      if (supabase) {
        const { data: cached } = await supabase
          .from('insights')
          .select('*')
          .eq('business_id', business_id)
          .order('created_at', { ascending: true });
        if (cached && cached.length > 0) {
          console.log('[/api/generate-insights] cache hit for', business_id);
          return res.json({ insights: cached, cached: true });
        }
      }
    }

    // Normalise: accept both string[] (legacy) and {review_text, rating}[] (current)
    const normalised = reviews.map(r =>
      typeof r === 'string'
        ? { review_text: r, rating: null }
        : { review_text: r.review_text ?? '', rating: r.rating ?? null }
    );

    // Balanced sample: more positives so AI can surface wins alongside problems
    const negative = normalised.filter(r => r.rating !== null && r.rating <= 2).slice(0, 25);
    const neutral  = normalised.filter(r => r.rating === 3).slice(0, 15);
    const positive = normalised.filter(r => r.rating !== null && r.rating >= 4).slice(0, 40);
    let balanced = [...negative, ...neutral, ...positive];

    // Fallback: if rating data is missing/null for all reviews, use all reviews as-is
    if (balanced.length === 0) {
      balanced = normalised.slice(0, 80);
    }

    console.log(`[generate-insights] sample: ${negative.length} negative, ${neutral.length} neutral, ${positive.length} positive = ${balanced.length} total (from ${normalised.length} reviews)`);

    const sample = balanced
      .map(r => `[${r.rating ?? '?'}★] ${r.review_text.substring(0, 120)}`)
      .join('\n');

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'You are a business intelligence engine. Return only valid JSON — no markdown, no explanation, no code fences.',
      messages: [{
        role: 'user',
        content:
          `Generate 6-8 insights for "${businessName}", a ${businessType}. Analyzing ${balanced.length} customer reviews (each prefixed with star rating).\n\n` +
          `MUST include a balanced mix:\n` +
          `- At least 2-3 "Winning" insights: things customers love, repeatedly praise, or mention by name\n` +
          `- At least 2-3 problem insights: recurring complaints with clear fix\n` +
          `- At least 1 "Opportunity" insight: something underrated that could be promoted or improved\n\n` +
          `For WINNING insights, QUANTIFY them specifically:\n` +
          `- "X% of reviewers mention [specific item/aspect] positively"\n` +
          `- "[Specific dish/feature] appears in N reviews — your most talked-about strength"\n` +
          `- "Staff praise appears in N reviews — a key differentiator worth promoting"\n\n` +
          `Return a JSON object with this exact shape:\n` +
          `{\n` +
          `  "insights": [\n` +
          `    {\n` +
          `      "icon": "<🏆 for winning, 🚀 for opportunity, ⚠️ for problems — or other relevant emoji>",\n` +
          `      "category": "<one of: Winning|Service|Food|Pricing|Ambiance|Opportunity>",\n` +
          `      "title": "<concise headline citing the specific pattern, 60 chars max>",\n` +
          `      "description": "<2 sentences: the pattern found and exact count/percentage of reviews>",\n` +
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
