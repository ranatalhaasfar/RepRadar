import { getClient, getSupabase } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

function sanitizeText(text) {
  if (!text) return ''
  return text
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\0/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
}

function getSeverity(mentionCount, trend, trend_pct) {
  let level = mentionCount >= 10 ? 'critical' : mentionCount >= 8 ? 'serious' : mentionCount >= 5 ? 'moderate' : 'minor'
  // Escalate if trending worsening 20%+
  if (trend === 'worsening' && trend_pct >= 20) {
    if (level === 'moderate') level = 'serious'
    else if (level === 'serious') level = 'critical'
  }
  return level
}

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
        const generatedAt = cached.generated_at;
        const staleAfter = new Date(new Date(generatedAt).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

        // Normalize cached row — fill in safe defaults for anything missing
        const normalized = {
          ...cached,
          problems:            Array.isArray(cached.problems)            ? cached.problems            : [],
          competitor_analysis: Array.isArray(cached.competitor_analysis) ? cached.competitor_analysis : [],
          week_buckets:        Array.isArray(cached.week_buckets)        ? cached.week_buckets        : [],
          total_reviews:       cached.total_reviews   ?? 0,
          potential_score:     cached.potential_score ?? cached.health_score ?? 0,
          health_score:        cached.health_score    ?? 0,
          health_breakdown:    cached.health_breakdown ?? null,
          crisis_status:       cached.crisis_status   ?? 'healthy',
          unanswered_count:    cached.unanswered_count ?? 0,
          oldest_unanswered:   cached.oldest_unanswered ?? null,
          stale_after:         staleAfter,
          weekly_brief: cached.weekly_brief ? {
            ...cached.weekly_brief,
            action_items: Array.isArray(cached.weekly_brief.action_items) ? cached.weekly_brief.action_items : [],
          } : {
            week_label: '', weekly_stats: { this_week_count: 0, last_week_count: 0, this_week_rating: null, last_week_rating: null },
            narrative: '', top_priority: '', biggest_win: '', action_items: [],
          },
          cached: true,
        };
        return res.json(normalized);
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
      .select('review_text, rating, sentiment, reviewed_at, reviewer_name')
      .eq('business_id', business_id)
      .order('reviewed_at', { ascending: false });

    if (revErr) throw new Error(`Reviews fetch error: ${revErr.message}`);
    const reviews = reviewRows ?? [];

    if (reviews.length < 5) {
      return res.status(422).json({ error: 'insufficient_reviews', count: reviews.length });
    }

    // ── Fetch competitors (metadata only — reviews are not stored in DB) ──────
    const { data: competitors } = await supabase
      .from('competitors')
      .select('id, name, google_rating, total_reviews')
      .eq('business_id', business_id);

    console.log(`[intelligence] competitors found: ${competitors?.length ?? 0}`);
    if (competitors?.length) {
      console.log('[intelligence] competitor sample:', JSON.stringify(competitors[0]));
    }

    const competitorData = competitors ?? [];

    // ── Build weekly buckets (last 8 weeks) ───────────────────────────────
    const now = new Date();
    const weekBuckets = Array.from({ length: 8 }, (_, i) => {
      const start = new Date(now);
      start.setDate(start.getDate() - (7 - i) * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const monthAbbr = start.toLocaleDateString('en-US', { month: 'short' });
      const day = start.getDate();
      return { label: `${monthAbbr} ${day}`, start, end, negative: 0, total: 0 };
    });

    // ── Sonnet call: detect top complaints + weekly brief ─────────────────
    // Send richer context: rating, date, sentiment for each review
    const sample = reviews
      .slice(0, 100)
      .map(r => {
        const date = r.reviewed_at ? new Date(r.reviewed_at).toISOString().split('T')[0] : 'unknown';
        const rating = r.rating !== null && r.rating !== undefined ? `${r.rating}★` : 'no-rating';
        const sentiment = r.sentiment ?? 'unknown';
        return `[${date}|${rating}|${sentiment}] ${sanitizeText(r.review_text).substring(0, 150)}`;
      })
      .join('\n');

    const weekStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const safeName = sanitizeText(business_name);
    const safeType = sanitizeText(business_type);

    const myAvgRatingStr = reviews.length > 0
      ? (reviews.reduce((s, r) => s + (r.rating ?? 4), 0) / reviews.length).toFixed(1)
      : null;


    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: 'You are a senior business intelligence analyst specializing in reputation management. Return ONLY valid JSON — no markdown, no code fences, no commentary.',
      messages: [{
        role: 'user',
        content:
          `Analyze these customer reviews for "${safeName}" (${safeType}) for the week of ${weekStr}.\n` +
          `This business has an average rating of ${myAvgRatingStr ?? 'unknown'} stars.\n\n` +
          `Each review line is formatted as: [date|rating|sentiment] text\n\n` +
          `Return a JSON object with EXACTLY this shape:\n` +
          `{\n` +
          `  "problems": [\n` +
          `    {\n` +
          `      "name": "Specific complaint name based on actual review language",\n` +
          `      "keywords": ["topic", "words", "customers", "use"],\n` +
          `      "negativeIndicators": ["smell", "bad", "worst", "never again", "rotten", "disgusting"],\n` +
          `      "trend": "worsening",\n` +
          `      "trend_pct": 15,\n` +
          `      "specific_action": "Specific actionable advice for this business, not generic platitudes"\n` +
          `    }\n` +
          `  ],\n` +
          `  "weekly_narrative": "A full paragraph written like a business consultant delivering a frank assessment of what the reviews reveal this week. Include specific patterns, risks, and opportunities.",\n` +
          `  "top_priority": "Single most important action this week — be specific",\n` +
          `  "biggest_win": "One positive highlight from this week's reviews",\n` +
          `  "action_items": ["specific action 1", "specific action 2", "specific action 3"]\n` +
          `}\n\n` +
          `Rules:\n` +
          `- Identify 3-6 specific problems customers complain about in negative reviews\n` +
          `- keywords: 4-10 lowercase words/phrases customers use to describe this problem\n` +
          `- negativeIndicators: 4-8 words that signal this specific complaint is negative (not just topic words)\n` +
          `- trend: must be exactly one of: "worsening", "improving", or "stable"\n` +
          `- trend_pct: estimated percentage change (0-50)\n` +
          `- specific_action: must be tailored to this business type and problem, not generic\n` +
          `- weekly_narrative: write like a consultant — frank, specific, actionable\n` +
          `\nReviews:\n${sample}`,
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
      const negativeIndicators = (p.negativeIndicators || []).map(ni => ni.toLowerCase());

      // Match reviews that are BOTH about the topic AND negative
      const matchResults = lowerReviews
        .map((text, i) => ({ i, text, review: reviews[i] }))
        .filter(({ text, review }) => {
          const hasKeyword = keywords.some(kw => text.includes(kw))
          if (!hasKeyword) return false
          // Must also be negative: either has negative indicator words, or sentiment=negative, or rating<=2
          const hasNegativeIndicator = negativeIndicators.some(ni => text.includes(ni))
          const isNegativeSentiment = review.sentiment === 'negative'
          const isLowRating = review.rating !== null && review.rating !== undefined && review.rating <= 2
          return hasNegativeIndicator || isNegativeSentiment || isLowRating
        })

      const matchedIndices = matchResults.map(({ i }) => i)

      // Build match_reasons: which keyword and indicator matched for each review
      const match_reasons = matchResults.map(({ i, text }) => {
        const matchedKeyword = keywords.find(kw => text.includes(kw)) || ''
        const matchedIndicator = negativeIndicators.find(ni => text.includes(ni)) || null
        return { index: i, matchedKeyword, matchedIndicator }
      })

      const matched = matchedIndices.map(i => reviews[i]);

      // Snippets: prefer negative or low-rated reviews
      const snippets = matched
        .filter(r => (r.review_text || '').trim().length > 20)
        .sort((a, b) => {
          const aScore = (a.rating || 5) + (a.sentiment === 'negative' ? -10 : 0)
          const bScore = (b.rating || 5) + (b.sentiment === 'negative' ? -10 : 0)
          return aScore - bScore
        })
        .slice(0, 3)
        .map(r => (r.review_text || '').substring(0, 120).trim());

      // Weekly complaint volume for trend chart (mention_timeline = 8 week buckets)
      const mention_timeline = weekBuckets.map(bucket => {
        return matched.filter(r => {
          if (!r.reviewed_at) return false;
          const d = new Date(r.reviewed_at);
          return d >= bucket.start && d < bucket.end;
        }).length;
      });

      // first_seen: earliest matched review date
      const datesOfMatched = matched
        .filter(r => r.reviewed_at)
        .map(r => new Date(r.reviewed_at).getTime())
      const first_seen = datesOfMatched.length > 0
        ? new Date(Math.min(...datesOfMatched)).toISOString()
        : null

      // low_star_correlation: how many 1-2 star reviews mention this problem
      const low_star_correlation = matched.filter(r => r.rating !== null && r.rating !== undefined && r.rating <= 2).length

      const severity = getSeverity(matchedIndices.length, p.trend || 'stable', p.trend_pct || 0)

      return {
        rank:               idx + 1,
        name:               p.name,
        keywords,
        negativeIndicators,
        mention_count:      matchedIndices.length,
        trend:              p.trend || 'stable',
        trend_pct:          p.trend_pct || 0,
        severity,
        snippets,
        review_indices:     matchedIndices.slice(0, 50),
        weekly_volume:      mention_timeline,   // keep for chart compatibility
        mention_timeline,
        first_seen,
        low_star_correlation,
        match_reasons,
        specific_action:    p.specific_action || '',
      };
    }).sort((a, b) => b.mention_count - a.mention_count)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    // ── Severity-based crisis status ──────────────────────────────────────
    const criticalProblems = problems.filter(p => p.severity === 'critical')
    const seriousProblems = problems.filter(p => p.severity === 'serious')
    const moderateProblems = problems.filter(p => p.severity === 'moderate')
    let crisis_status = 'healthy'
    if (criticalProblems.length > 0) crisis_status = 'crisis'
    else if (seriousProblems.length > 0 || moderateProblems.length >= 2) crisis_status = 'warning'

    // ── Unanswered reviews count ──────────────────────────────────────────
    // Unanswered = negative reviews (sentiment=negative OR rating<=2) with no tracked response
    const negativeReviews = reviews.filter(r => r.sentiment === 'negative' || (r.rating !== null && r.rating !== undefined && r.rating <= 2))
    const unanswered_count = negativeReviews.length
    // oldest unanswered: sort ascending and take last element (oldest = smallest date value)
    const oldestNegative = [...negativeReviews]
      .filter(r => r.reviewed_at)
      .sort((a, b) => new Date(a.reviewed_at).getTime() - new Date(b.reviewed_at).getTime())
    const oldest_unanswered = oldestNegative.length > 0 ? oldestNegative[0].reviewed_at : null

    // ── Competitor analysis — fully data-driven, no AI guessing ──────────
    // Competitor reviews are not stored in the DB (fetched by CompetitorSpy
    // in-memory only), so all bullets are computed from hard facts:
    // ratings, review counts, and our own problem data.
    const myAvgRating = reviews.length > 0
      ? reviews.reduce((s, r) => s + (r.rating ?? 4), 0) / reviews.length
      : 4;
    const myReviewCount = reviews.length;

    const competitor_analysis = competitorData.map(comp => {
      const compRating     = comp.google_rating ?? null;
      const compCount      = comp.total_reviews ?? null;
      const ratingGap      = compRating != null ? Math.round((myAvgRating - compRating) * 10) / 10 : null;

      // ── They Beat Us: only real, numbered facts ──
      const they_do_better = [];
      if (compCount != null && myReviewCount > 0 && compCount > myReviewCount) {
        const ratio = (compCount / myReviewCount).toFixed(1);
        they_do_better.push(
          `${compCount.toLocaleString()} reviews vs your ${myReviewCount.toLocaleString()} — ${ratio}x more social proof`
        );
      }
      if (ratingGap != null && ratingGap < 0) {
        // They have higher rating
        they_do_better.push(
          `Higher rating by ${Math.abs(ratingGap).toFixed(1)} stars (${compRating} vs your ${myAvgRating.toFixed(1)})`
        );
      }
      if (they_do_better.length === 0 && compCount != null && compCount > myReviewCount) {
        they_do_better.push(`${compCount.toLocaleString()} total reviews — stronger review volume`);
      }

      // ── Their Complaints: use our own top problems as proxy ──
      // We don't have their review text, so we surface our shared problems
      // (issues common to this business type) with actual mention counts.
      // Only include problems with 3+ mentions (significant threshold).
      const no_reviews = true; // competitor review text not in DB
      const weaknesses = problems
        .filter(p => p.mention_count >= 3)
        .slice(0, 4)
        .map(p => `"${p.name}" — mentioned in ${p.mention_count} of your reviews (likely affects competitors too)`);

      // ── Our Opportunity: only include if we actually have the advantage ──
      const opportunities = [];
      if (ratingGap != null && ratingGap > 0) {
        opportunities.push(
          `You rate ${ratingGap.toFixed(1)} stars higher (${myAvgRating.toFixed(1)} vs ${compRating}) — mention this in your marketing`
        );
      }
      if (compCount != null && myReviewCount > compCount) {
        opportunities.push(
          `You have ${myReviewCount.toLocaleString()} reviews vs their ${compCount.toLocaleString()} — you have stronger social proof`
        );
      }
      // Top worsening problem = opportunity to differentiate if we fix it first
      const worseningProblem = problems.find(p => p.trend === 'worsening' && p.mention_count >= 3);
      if (worseningProblem) {
        opportunities.push(
          `Fix "${worseningProblem.name}" before competitors do — ${worseningProblem.mention_count} mentions and worsening`
        );
      }
      // If they have more reviews, prompt for a review campaign
      if (compCount != null && compCount > myReviewCount * 2) {
        opportunities.push(
          `Launch a review request campaign — close the ${Math.round(compCount / Math.max(myReviewCount, 1))}x review gap`
        );
      }

      return {
        id:            comp.id,
        name:          comp.name,
        google_rating: comp.google_rating,
        total_reviews: comp.total_reviews,
        rating_gap:    ratingGap ?? 0,
        no_reviews,
        weaknesses,
        they_do_better,
        opportunities,
      };
    });

    // ── Health score ──────────────────────────────────────────────────────
    const totalReviews = reviews.length;
    const positiveCount = reviews.filter(r => r.sentiment === 'positive').length;
    const sentimentScore = totalReviews > 0
      ? Math.round((positiveCount / totalReviews) * 100)
      : 50;

    // Deductions from problems (up to 5)
    const deductions = problems.slice(0, 5).map(p => ({
      name: p.name,
      points: -(p.severity === 'critical' ? 25 : p.severity === 'serious' ? 20 : p.severity === 'moderate' ? 15 : 5),
      severity: p.severity,
      trend: p.trend,
    }))

    const totalDeduction = deductions.reduce((sum, d) => sum + d.points, 0)
    let healthScore = Math.max(20, Math.min(100, sentimentScore + totalDeduction))

    // Cap score when critical problems exist — a business with 10+ mention
    // complaints cannot truthfully score above 70 regardless of sentiment mix
    const criticalByMentions = problems.filter(p => p.mention_count >= 10).length
    if (criticalByMentions >= 2) healthScore = Math.min(healthScore, 55)
    else if (criticalByMentions >= 1) healthScore = Math.min(healthScore, 70)

    const potentialScore = Math.min(100, healthScore + 50)

    // score_if_fixed projections
    const top1Deduction = deductions.length > 0 ? Math.abs(deductions[0].points) : 0
    const top3Deduction = deductions.slice(0, 3).reduce((sum, d) => sum + Math.abs(d.points), 0)

    const healthBreakdown = {
      base: sentimentScore,
      deductions,
      boosts: [],
      score_if_fixed_top1: Math.min(100, healthScore + top1Deduction),
      score_if_fixed_top3: Math.min(100, healthScore + top3Deduction),
    }

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
    const generated_at = new Date().toISOString()
    const stale_after = new Date(new Date(generated_at).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()

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
        action_items: Array.isArray(aiData.action_items) ? aiData.action_items : [],
      },
      health_score:      Math.round(healthScore),
      health_breakdown:  healthBreakdown,
      potential_score:   potentialScore,
      total_reviews:     totalReviews,
      week_buckets:      weekBuckets.map(b => b.label),
      crisis_status,
      unanswered_count,
      oldest_unanswered,
      generated_at,
      stale_after,
      cached: false,
    };

    // ── Persist to Supabase (safe — only known columns) ───────────────────
    try {
      await supabase.from('intelligence_reports').delete().eq('business_id', business_id)
      const { error: insertErr } = await supabase.from('intelligence_reports').insert({
        business_id,
        problems:             report.problems,
        competitor_analysis:  report.competitor_analysis,
        weekly_brief:         report.weekly_brief,
        health_score:         report.health_score,
        generated_at:         report.generated_at,
      })
      if (insertErr) console.error('[intelligence] DB insert error:', insertErr.message)
    } catch (e) {
      console.error('[intelligence] DB insert failed:', e.message)
    }

    return res.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-intelligence]', message);
    return res.status(500).json({ error: message });
  }
}
