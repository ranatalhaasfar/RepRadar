import { getClient, getSupabase } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

const CHUNK_SIZE = 50;

function chunkArray(arr, size) {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

async function analyzeChunk(chunk) {
  const numbered = chunk.map((r, i) => `${i + 1}. ${(r.review_text || r || '').substring(0, 150)}`).join('\n');
  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: 'You are a review analysis engine. Return only valid JSON — no markdown, no explanation, no code fences.',
    messages: [{
      role: 'user',
      content:
        `Analyze these ${chunk.length} customer reviews and return a JSON object with this exact shape:\n` +
        `{\n` +
        `  "sentimentCounts": { "positive": <int>, "negative": <int>, "neutral": <int> },\n` +
        `  "reputationScore": <int 0-100>,\n` +
        `  "topKeywords": [<up to 8 most mentioned words/phrases, lowercase strings>],\n` +
        `  "reviewSentiments": [<array of "positive"|"negative"|"neutral" for each review in order>]\n` +
        `}\n\n` +
        `Reviews:\n${numbered}`,
    }],
  });
  return extractJSONObject(response.content[0].type === 'text' ? response.content[0].text : '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reviews, business_id } = req.body;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'reviews array is required.' });
  }

  try {
    // Hard cache check — if business was already analyzed, return cached stats
    if (business_id) {
      const supabase = getSupabase();
      if (supabase) {
        const { data: biz } = await supabase
          .from('businesses')
          .select('analyzed_at, reputation_score, keywords')
          .eq('id', business_id)
          .single();
        const { data: revRows } = await supabase
          .from('reviews')
          .select('id, sentiment')
          .eq('business_id', business_id)
          .not('sentiment', 'is', null);
        if (biz?.analyzed_at && revRows && revRows.length > 0) {
          console.log('[/api/analyze-reviews] cache hit for', business_id);
          const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
          const reviewSentiments = revRows.map(r => {
            sentimentCounts[r.sentiment] = (sentimentCounts[r.sentiment] || 0) + 1;
            return r.sentiment;
          });
          return res.json({ sentimentCounts, reputationScore: biz.reputation_score ?? 0, topKeywords: biz.keywords ?? [], reviewSentiments, cached: true });
        }
      }
    }

    // Chunk reviews into groups of 50 to avoid token truncation
    const chunks = chunkArray(reviews, CHUNK_SIZE);
    console.log(`[/api/analyze-reviews] ${reviews.length} reviews → ${chunks.length} chunks of ${CHUNK_SIZE}`);

    const chunkResults = [];
    for (const chunk of chunks) {
      const result = await analyzeChunk(chunk);
      chunkResults.push(result);
    }

    // Merge: sum sentiment counts, average reputation score, union keywords, concat sentiments
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    const reviewSentiments = [];
    const keywordSet = new Set();
    let totalScore = 0;

    for (const r of chunkResults) {
      sentimentCounts.positive += r.sentimentCounts?.positive ?? 0;
      sentimentCounts.negative += r.sentimentCounts?.negative ?? 0;
      sentimentCounts.neutral  += r.sentimentCounts?.neutral  ?? 0;
      totalScore += r.reputationScore ?? 0;
      for (const kw of (r.topKeywords ?? [])) keywordSet.add(kw);
      for (const s  of (r.reviewSentiments ?? [])) reviewSentiments.push(s);
    }

    const reputationScore = Math.round(totalScore / chunkResults.length);
    const topKeywords = [...keywordSet].slice(0, 8);

    console.log(`[/api/analyze-reviews] merged: ${reviewSentiments.length} sentiments, score=${reputationScore}`);
    res.json({ sentimentCounts, reputationScore, topKeywords, reviewSentiments });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/analyze-reviews]', message);
    res.status(500).json({ error: message });
  }
}
