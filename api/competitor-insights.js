import { getClient, getSupabase, checkPlanAccess } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    business_id,
    competitor_id,
    businessName,
    businessType,
    myRating,
    competitorName,
    competitorRating,
    competitorReviews = [],
    myReviews = [],
    refresh = false,
    user_id,
  } = req.body;

  if (!business_id || !competitor_id) {
    return res.status(400).json({ error: 'business_id and competitor_id are required.' });
  }

  const supabase = getSupabase();

  const { isPaid } = await checkPlanAccess(supabase, user_id);
  if (!isPaid) return res.status(403).json({ error: 'upgrade_required', message: 'This feature requires a paid plan.' });

  // Cache hit — return existing insights unless refresh=true
  if (!refresh && supabase) {
    const { data: cached } = await supabase
      .from('competitor_analysis')
      .select('*')
      .eq('business_id', business_id)
      .eq('competitor_id', competitor_id)
      .order('generated_at', { ascending: false })
      .limit(1);
    if (cached && cached.length > 0) {
      console.log('[competitor-insights] cache hit for', competitor_id);
      return res.json({ insights: cached[0].insights, cached: true, generated_at: cached[0].generated_at });
    }
  }

  if (competitorReviews.length === 0) {
    return res.status(400).json({ error: 'No competitor reviews to analyze.' });
  }

  const compSample = competitorReviews.slice(0, 30).map(r => String(r).substring(0, 200)).join('\n');
  const mySample   = myReviews.slice(0, 15).map(r => String(r).substring(0, 200)).join('\n');

  const ratingGap = myRating && competitorRating
    ? (myRating - competitorRating).toFixed(1)
    : null;

  try {
    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: 'You are a competitive intelligence engine. Return only valid JSON — no markdown, no explanation, no code fences.',
      messages: [{
        role: 'user',
        content:
          `You are comparing "${businessName}" (a ${businessType}) against competitor "${competitorName}".\n\n` +
          `Ratings: ${businessName}=${myRating ?? 'unknown'}★, ${competitorName}=${competitorRating ?? 'unknown'}★\n` +
          (ratingGap !== null ? `Rating gap: ${Number(ratingGap) >= 0 ? '+' : ''}${ratingGap} in favor of ${Number(ratingGap) >= 0 ? businessName : competitorName}\n` : '') +
          `\nCompetitor reviews (${competitorReviews.length} fetched):\n${compSample}\n\n` +
          (mySample ? `Your business reviews (sample):\n${mySample}\n\n` : '') +
          `Return a JSON object with exactly this shape:\n` +
          `{\n` +
          `  "review_velocity": "<1-2 sentences on how frequently they receive reviews and what that signals>",\n` +
          `  "biggest_weakness": "<their most common complaint or failure pattern based on reviews>",\n` +
          `  "your_advantages": ["<advantage 1>", "<advantage 2>", "<advantage 3>"],\n` +
          `  "rating_trend": "<improving, declining, or stable — and what is driving it>",\n` +
          `  "steal_their_customers": "<1 concrete tactic to win customers from this specific competitor based on their weaknesses>"\n` +
          `}`,
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const insights = extractJSONObject(text);

    // Persist to Supabase
    if (supabase) {
      try {
        await supabase
          .from('competitor_analysis')
          .delete()
          .eq('business_id', business_id)
          .eq('competitor_id', competitor_id);

        const { error: insertErr } = await supabase
          .from('competitor_analysis')
          .insert({
            business_id,
            competitor_id,
            competitor_name: competitorName,
            insights,
            generated_at: new Date().toISOString(),
          });
        if (insertErr) console.error('[competitor-insights] DB insert error:', insertErr.message);
        else console.log('[competitor-insights] saved insights for', competitorName);
      } catch (e) {
        console.error('[competitor-insights] DB save failed:', e.message);
      }
    }

    return res.json({ insights, cached: false, generated_at: new Date().toISOString() });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/competitor-insights]', message);
    return res.status(500).json({ error: message });
  }
}
