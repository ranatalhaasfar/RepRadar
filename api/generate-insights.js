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

    // Balanced sample: prioritise negative reviews, include neutral and positive
    const negative = reviews.filter(r => r.rating <= 2).slice(0, 30);
    const neutral  = reviews.filter(r => r.rating === 3).slice(0, 20);
    const positive = reviews.filter(r => r.rating >= 4).slice(0, 30);
    const balanced = [...negative, ...neutral, ...positive];

    console.log(`[generate-insights] sample: ${negative.length} negative, ${neutral.length} neutral, ${positive.length} positive = ${balanced.length} total`);

    const sample = balanced
      .map(r => `[${r.rating ?? '?'}★] ${(r.review_text || r || '').substring(0, 120)}`)
      .join('\n');

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'You are a business intelligence engine. Return only valid JSON — no markdown, no explanation, no code fences.',
      messages: [{
        role: 'user',
        content:
          `You are analyzing ${balanced.length} customer reviews for "${businessName}", a ${businessType}.\n` +
          `Each review is prefixed with its star rating.\n` +
          `Generate 4 to 6 specific, evidence-based insights. Each insight must:\n` +
          `- Reference actual patterns seen across multiple reviews (not generic advice)\n` +
          `- Mention approximately how many reviews mention this issue\n` +
          `- Give a recommendation specific to this business type, not generic platitudes\n\n` +
          `Return a JSON object with this exact shape:\n` +
          `{\n` +
          `  "insights": [\n` +
          `    {\n` +
          `      "icon": "<single relevant emoji>",\n` +
          `      "category": "<one of: Service|Food|Pricing|Ambiance|Trending|Opportunity>",\n` +
          `      "title": "<concise insight headline citing the specific issue, 60 chars max>",\n` +
          `      "description": "<2 sentences citing the pattern found and how many reviews mention it>",\n` +
          `      "recommendation": "<specific actionable advice tailored to this business type, 2-3 sentences>",\n` +
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
