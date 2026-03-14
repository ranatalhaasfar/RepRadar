import { getClient, getSupabase } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { businessName, businessType, reviews, business_id } = req.body;
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
    const sample = reviews.slice(0, 20).map(r => (r.review_text || r || '').substring(0, 150)).join('\n');

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: 'You are a business intelligence engine. Return only valid JSON — no markdown, no explanation, no code fences.',
      messages: [{
        role: 'user',
        content:
          `You are analyzing customer reviews for "${businessName}", a ${businessType}.\n` +
          `Generate 4 to 6 actionable business insights based on these reviews.\n\n` +
          `Return a JSON object with this exact shape:\n` +
          `{\n` +
          `  "insights": [\n` +
          `    {\n` +
          `      "icon": "<single relevant emoji>",\n` +
          `      "category": "<one of: Service|Food|Pricing|Ambiance|Trending|Opportunity>",\n` +
          `      "title": "<concise insight headline, 60 chars max>",\n` +
          `      "description": "<2 sentence explanation of the pattern found>",\n` +
          `      "recommendation": "<specific actionable advice, 2-3 sentences>",\n` +
          `      "impact": "<High|Medium|Low>"\n` +
          `    }\n` +
          `  ]\n` +
          `}\n\n` +
          `Reviews:\n${sample}`,
      }],
    });

    const data = extractJSONObject(response.content[0].type === 'text' ? response.content[0].text : '')
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-insights]', message);
    res.status(500).json({ error: message });
  }
}
