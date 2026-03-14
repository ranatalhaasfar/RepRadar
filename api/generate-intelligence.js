import { getClient, getSupabase } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { business_id, business_name, business_type, force_refresh } = req.body;
  if (!business_id) {
    return res.status(400).json({ error: 'business_id is required.' });
  }

  const supabase = getSupabase();

  // ── Cache check (7-day TTL) ────────────────────────────────────────────────
  if (!force_refresh && supabase) {
    const { data: cached } = await supabase
      .from('intelligence_reports')
      .select('*')
      .eq('business_id', business_id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();

    if (cached) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (age < sevenDays) {
        console.log('[/api/generate-intelligence] cache hit for', business_id);
        return res.json({ ...cached, cached: true });
      }
    }
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured — set SUPABASE_SERVICE_ROLE_KEY.' });
    }

    // ── Fetch reviews ──────────────────────────────────────────────────────
    const { data: reviewRows, error: revErr } = await supabase
      .from('reviews')
      .select('review_text, rating, sentiment, reviewed_at')
      .eq('business_id', business_id)
      .order('reviewed_at', { ascending: false });

    if (revErr) throw new Error(`Reviews fetch error: ${revErr.message}`);
    const reviews = reviewRows ?? [];

    if (reviews.length < 5) {
      return res.status(422).json({ error: 'insufficient_reviews', count: reviews.length });
    }

    // ── Fetch competitors + their reviews ──────────────────────────────────
    const { data: competitors } = await supabase
      .from('competitors')
      .select('id, name, google_rating')
      .eq('business_id', business_id);

    const competitorData = [];
    if (competitors && competitors.length > 0) {
      for (const comp of competitors) {
        const { data: compRevs } = await supabase
          .from('reviews')
          .select('review_text, sentiment')
          .eq('business_id', comp.id)
          .limit(100);
        competitorData.push({ ...comp, reviews: compRevs ?? [] });
      }
    }

    // ── Build weekly buckets (last 8 weeks) from reviews ──────────────────
    const now = new Date();
    const weekBuckets = Array.from({ length: 8 }, (_, i) => {
      const start = new Date(now);
      start.setDate(start.getDate() - (7 - i) * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { label: `W${i + 1}`, start, end, negative: 0, total: 0 };
    });

    // ── Haiku call: detect top complaints + weekly brief ──────────────────
    const sample = reviews
      .slice(0, 80)
      .map(r => `[${r.sentiment ?? 'unknown'}] ${(r.review_text || '').substring(0, 100)}`)
      .join('\n');

    const weekStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const response = await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: 'You are a business intelligence analyst. Return ONLY valid JSON — no markdown, no code fences.',
      messages: [{
        role: 'user',
        content:
          `Analyze these customer reviews for "${business_name}" (${business_type}).\n\n` +
          `Return a JSON object with EXACTLY this shape:\n` +
          `{\n` +
          `  "problems": [\n` +
          `    {\n` +
          `      "name": "string — complaint topic",\n` +
          `      "keywords": ["array", "of", "trigger", "words"],\n` +
          `      "trend": "worsening" | "improving" | "stable",\n` +
          `      "trend_pct": 0\n` +
          `    }\n` +
          `  ],\n` +
          `  "weekly_narrative": "3-5 sentence summary of the business this week based on reviews",\n` +
          `  "top_priority": "one bold action item for this week",\n` +
          `  "biggest_win": "one positive highlight from this week",\n` +
          `  "action_items": ["action 1", "action 2", "action 3"]\n` +
          `}\n\n` +
          `Rules:\n` +
          `- Identify 3-5 specific problems customers complain about\n` +
          `- keywords: 4-8 lowercase words customers use for this problem\n` +
          `- trend: based on whether recent reviews mention it more or less\n` +
          `- trend_pct: estimated percentage change (0-50)\n` +
          `- Week of ${weekStr}\n\n` +
          `Reviews:\n${sample}`,
      }],
    });

    const aiData = extractJSONObject(response.content[0]?.type === 'text' ? response.content[0].text : '');
    if (!aiData || !Array.isArray(aiData.problems)) {
      throw new Error('AI returned invalid structure');
    }

    // ── Local: match review indices + counts per problem ──────────────────
    const lowerReviews = reviews.map(r => (r.review_text || '').toLowerCase());

    const problems = (aiData.problems || []).map((p, idx) => {
      const keywords = (p.keywords || []).map(k => k.toLowerCase());
      const matchedIndices = lowerReviews
        .map((text, i) => ({ i, text }))
        .filter(({ text }) => keywords.some(kw => text.includes(kw)))
        .map(({ i }) => i);

      const matched = matchedIndices.map(i => reviews[i]);
      const snippets = matched
        .filter(r => (r.review_text || '').trim().length > 20)
        .slice(0, 3)
        .map(r => (r.review_text || '').substring(0, 120).trim());

      // Weekly complaint volume for trend chart
      const weeklyVolume = weekBuckets.map(bucket => {
        return matched.filter(r => {
          if (!r.reviewed_at) return false;
          const d = new Date(r.reviewed_at);
          return d >= bucket.start && d < bucket.end;
        }).length;
      });

      return {
        rank:          idx + 1,
        name:          p.name,
        keywords,
        mention_count: matchedIndices.length,
        trend:         p.trend || 'stable',
        trend_pct:     p.trend_pct || 0,
        snippets,
        review_indices: matchedIndices.slice(0, 50),
        weekly_volume:  weeklyVolume,
      };
    }).sort((a, b) => b.mention_count - a.mention_count)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    // ── Local: competitor weakness analysis ───────────────────────────────
    const competitor_analysis = competitorData.map(comp => {
      const compLower = comp.reviews.map(r => (r.review_text || '').toLowerCase());

      const weaknesses = problems.slice(0, 3).map(prob => {
        const compMentions = compLower.filter(text =>
          prob.keywords.some(kw => text.includes(kw))
        ).length;
        const myPositiveRate = prob.review_indices.length > 0
          ? prob.review_indices.filter(i => reviews[i]?.sentiment === 'positive').length / prob.review_indices.length
          : 0;

        return {
          problem_name:   prob.name,
          comp_mentions:  compMentions,
          my_score_pct:   Math.round((1 - prob.mention_count / Math.max(reviews.length, 1)) * 100),
          my_positive_pct: Math.round(myPositiveRate * 100),
          opportunity:    compMentions > 3 && prob.mention_count < compMentions,
        };
      });

      return {
        id:            comp.id,
        name:          comp.name,
        google_rating: comp.google_rating,
        weaknesses,
      };
    });

    // ── Health score ──────────────────────────────────────────────────────
    const totalReviews = reviews.length;
    const positiveCount = reviews.filter(r => r.sentiment === 'positive').length;
    const negativeCount = reviews.filter(r => r.sentiment === 'negative').length;
    const sentimentScore = totalReviews > 0
      ? Math.round((positiveCount / totalReviews) * 100)
      : 50;

    const criticalProblems = problems.filter(p => p.mention_count > totalReviews * 0.15).length;
    const healthScore = Math.max(20, Math.min(100,
      sentimentScore
      - criticalProblems * 8
      - (negativeCount / Math.max(totalReviews, 1)) * 20
    ));

    const potentialScore = Math.min(100, Math.round(healthScore + problems.slice(0, 3).reduce((acc, p) => {
      return acc + Math.min(8, p.mention_count / Math.max(totalReviews, 1) * 30);
    }, 0)));

    // ── Weekly stats ──────────────────────────────────────────────────────
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const thisWeekRevs = reviews.filter(r => r.reviewed_at && new Date(r.reviewed_at) >= oneWeekAgo);
    const lastWeekRevs = reviews.filter(r => r.reviewed_at && new Date(r.reviewed_at) >= twoWeeksAgo && new Date(r.reviewed_at) < oneWeekAgo);

    const weeklyStats = {
      this_week_count: thisWeekRevs.length,
      last_week_count: lastWeekRevs.length,
      this_week_rating: thisWeekRevs.length > 0
        ? Math.round((thisWeekRevs.reduce((s, r) => s + (r.rating ?? 4), 0) / thisWeekRevs.length) * 10) / 10
        : null,
      last_week_rating: lastWeekRevs.length > 0
        ? Math.round((lastWeekRevs.reduce((s, r) => s + (r.rating ?? 4), 0) / lastWeekRevs.length) * 10) / 10
        : null,
    };

    const week_label = `Week of ${weekStr}`;
    const report = {
      business_id,
      problems,
      competitor_analysis,
      weekly_brief: {
        week_label,
        weekly_stats: weeklyStats,
        narrative:    aiData.weekly_narrative || '',
        top_priority: aiData.top_priority || '',
        biggest_win:  aiData.biggest_win || '',
        action_items: aiData.action_items || [],
      },
      health_score:      Math.round(healthScore),
      potential_score:   potentialScore,
      total_reviews:     totalReviews,
      week_buckets:      weekBuckets.map(b => b.label),
      generated_at:      new Date().toISOString(),
    };

    // ── Persist to Supabase ───────────────────────────────────────────────
    await supabase.from('intelligence_reports').delete().eq('business_id', business_id);
    await supabase.from('intelligence_reports').insert({
      business_id,
      problems:             report.problems,
      competitor_analysis:  report.competitor_analysis,
      weekly_brief:         report.weekly_brief,
      health_score:         report.health_score,
    });

    return res.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-intelligence]', message);
    return res.status(500).json({ error: message });
  }
}
