import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(cors());
app.use(express.json());

// ── Lazy Anthropic client ─────────────────────────────────────────────────

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in .env');
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ── Health check ──────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    anthropicKeySet: !!process.env.ANTHROPIC_API_KEY,
    googlePlacesKeySet: !!process.env.GOOGLE_PLACES_KEY,
    outscraperKeySet: !!process.env.OUTSCRAPER_API_KEY,
  });
});

// ── Tone descriptions ─────────────────────────────────────────────────────

const TONE_DESCRIPTIONS = {
  Friendly: 'warm, personable, and enthusiastic with a conversational tone that makes customers feel appreciated',
  Professional: 'polished, formal, and business-appropriate — respectful and composed',
  Apologetic: 'empathetic, sincere, and focused on understanding the customer\'s experience and making things right',
};

// ── POST /api/generate-response (streaming SSE) ───────────────────────────

app.post('/api/generate-response', async (req, res) => {
  const { review, tone } = req.body;

  if (!review?.trim() || !tone) {
    return res.status(400).json({ error: 'Review and tone are required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = getClient().messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      system:
        'You are an expert customer service consultant helping small business owners respond to customer reviews. ' +
        'Write concise, genuine responses (2-4 sentences) that are ready to copy and post publicly. ' +
        'Do not include a subject line, greeting label, or any meta-commentary — just the response text itself.',
      messages: [
        {
          role: 'user',
          content:
            `Write a ${tone} response to the following customer review.\n` +
            `The tone should be: ${TONE_DESCRIPTIONS[tone]}.\n\n` +
            `Customer Review:\n"${review.trim()}"\n\n` +
            `Write the response now, starting directly with the text:`,
        },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-response]', message);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

// ── POST /api/analyze-reviews ─────────────────────────────────────────────

app.post('/api/analyze-reviews', async (req, res) => {
  const { reviews } = req.body;

  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'reviews array is required.' });
  }

  try {
    const numbered = reviews.map((r, i) => `${i + 1}. ${r}`).join('\n');

    const response = await getClient().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: 'You are a review analysis engine. Return only valid JSON — no markdown, no explanation, no code fences.',
      messages: [{
        role: 'user',
        content:
          `Analyze these ${reviews.length} customer reviews and return a JSON object with this exact shape:\n` +
          `{\n` +
          `  "sentimentCounts": { "positive": <int>, "negative": <int>, "neutral": <int> },\n` +
          `  "reputationScore": <int 0-100>,\n` +
          `  "topKeywords": [<up to 8 most mentioned words/phrases, lowercase strings>],\n` +
          `  "reviewSentiments": [<array of "positive"|"negative"|"neutral" for each review in order>]\n` +
          `}\n\n` +
          `Reviews:\n${numbered}`,
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(clean);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/analyze-reviews]', message);
    res.status(500).json({ error: message });
  }
});

// ── POST /api/generate-insights ───────────────────────────────────────────

app.post('/api/generate-insights', async (req, res) => {
  const { businessName, businessType, reviews } = req.body;

  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'reviews array is required.' });
  }

  try {
    const sample = reviews.slice(0, 20).join('\n');

    const response = await getClient().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
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

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(clean);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-insights]', message);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/outscraper-search ────────────────────────────────────────────
// Search for a business by name + city. Returns top match with place_id,
// address, and Google rating — used for onboarding confirmation step.

app.get('/api/outscraper-search', async (req, res) => {
  const { name, city } = req.query;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OUTSCRAPER_API_KEY is not set.' });

  try {
    // search-v3 is always async — submit job, get results_location URL, poll it
    const query = encodeURIComponent(`${name} ${city || ''}`.trim());
    const submitUrl = `https://api.app.outscraper.com/maps/search-v3?query=${query}&limit=1`;
    console.log(`[outscraper-search] submitting: ${submitUrl}`);
    const submitResp = await fetch(submitUrl, { headers: { 'X-API-KEY': apiKey } });
    const submitText = await submitResp.text();
    console.log(`[outscraper-search] submit status=${submitResp.status} body=${submitText.slice(0, 300)}`);
    if (!submitResp.ok) {
      throw new Error(`Outscraper search submit failed (${submitResp.status}): ${submitText.slice(0, 300)}`);
    }
    let submitData;
    try { submitData = JSON.parse(submitText); } catch { throw new Error(`Outscraper non-JSON: ${submitText.slice(0, 200)}`); }

    // If sync result already in data field, use it directly
    if (submitData?.status === 'Success' && Array.isArray(submitData.data)) {
      const place = submitData.data.flat()[0];
      if (!place) return res.json({ found: false });
      return res.json({
        found: true,
        place_id: place.place_id ?? place.google_id ?? null,
        name: place.name ?? null,
        full_address: place.full_address ?? place.address ?? null,
        rating: typeof place.rating === 'number' ? place.rating : null,
        reviews_count: typeof place.reviews === 'number' ? place.reviews : null,
      });
    }

    // Async job — poll the results_location URL (on api.outscraper.cloud)
    const resultsUrl = submitData?.results_location;
    if (!resultsUrl) throw new Error('No results_location in Outscraper response');
    console.log(`[outscraper-search] polling: ${resultsUrl}`);

    for (let attempt = 1; attempt <= 10; attempt++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollResp = await fetch(resultsUrl, { headers: { 'X-API-KEY': apiKey } });
      const pollText = await pollResp.text();
      console.log(`[outscraper-search] poll ${attempt} status=${pollResp.status} body=${pollText.slice(0, 200)}`);
      if (!pollResp.ok) continue;
      let pollData;
      try { pollData = JSON.parse(pollText); } catch { continue; }

      if (pollData?.status === 'Success' && Array.isArray(pollData.data)) {
        const place = pollData.data.flat()[0];
        if (!place) return res.json({ found: false });
        console.log(`[outscraper-search] found: ${place.name}`);
        return res.json({
          found: true,
          place_id: place.place_id ?? place.google_id ?? null,
          name: place.name ?? null,
          full_address: place.full_address ?? place.address ?? null,
          rating: typeof place.rating === 'number' ? place.rating : null,
          reviews_count: typeof place.reviews === 'number' ? place.reviews : null,
        });
      }
    }
    throw new Error('Outscraper search timed out after 30 seconds');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/outscraper-search] ERROR:', message);
    res.status(500).json({ error: message });
  }
});

// ── Helper: extract reviews from Outscraper data array ────────────────────
// reviews-v3 returns reviews flat (each item IS a review) or nested under
// place.reviews — detect shape from first item and handle both.

function mapReview(r) {
  return {
    reviewer_name: r.author_title ?? r.reviewer_name ?? r.name ?? 'Anonymous',
    review_text:   r.review_text ?? r.text ?? r.snippet ?? '',
    rating:        typeof r.review_rating === 'number' ? r.review_rating
                 : typeof r.rating === 'number'        ? r.rating
                 : null,
    reviewed_at:   r.review_datetime_utc ?? r.review_timestamp ?? r.date ?? null,
  };
}

function extractReviews(dataArray) {
  const flat = dataArray.flat();
  if (flat.length === 0) { console.log('[extractReviews] dataArray is empty'); return []; }

  const first = flat[0];

  // Case 1: each item IS a review (has review_text directly)
  if (typeof first.review_text === 'string' || typeof first.text === 'string') {
    console.log(`[extractReviews] Case 1 — flat reviews, ${flat.length} items`);
    return flat.map(mapReview).filter(r => r.review_text.trim().length > 0);
  }

  // Case 2: each item is a place with a .reviews array
  if (Array.isArray(first.reviews)) {
    const all = flat.flatMap(place => place.reviews.map(mapReview))
      .filter(r => r.review_text.trim().length > 0);
    console.log(`[extractReviews] Case 2 — nested .reviews[], ${all.length} reviews from ${flat.length} places`);
    return all;
  }

  // Case 3: reviews-v3 sometimes wraps one level deeper — data is [[place, review, review, ...]]
  // where the inner array mixes the place object and individual review objects
  const inner = dataArray[0];
  if (Array.isArray(inner)) {
    const reviewItems = inner.filter(item => typeof item.review_text === 'string' || typeof item.text === 'string');
    if (reviewItems.length > 0) {
      console.log(`[extractReviews] Case 3 — inner array with ${reviewItems.length} review items`);
      return reviewItems.map(mapReview).filter(r => r.review_text.trim().length > 0);
    }
  }

  // Case 4: reviews are at a different key on the place object — scan all keys
  const reviewKey = Object.keys(first).find(k =>
    Array.isArray(first[k]) && first[k].length > 0 &&
    typeof first[k][0] === 'object' && first[k][0] !== null &&
    ('review_text' in first[k][0] || 'text' in first[k][0] || 'author_title' in first[k][0])
  );
  if (reviewKey) {
    const all = flat.flatMap(place => (Array.isArray(place[reviewKey]) ? place[reviewKey] : []).map(mapReview))
      .filter(r => r.review_text.trim().length > 0);
    console.log(`[extractReviews] Case 4 — reviews at key "${reviewKey}", ${all.length} reviews`);
    return all;
  }

  console.log('[extractReviews] Could not find reviews in any known location. Keys on first item:', Object.keys(first).join(', '));
  return [];
}

// ── POST /api/outscraper-reviews ──────────────────────────────────────────
// Fetch up to `limit` reviews for a given place_id via Outscraper async API.
// Polls every 10 s, up to 12 attempts (2 min). Returns a flat reviews array.

app.post('/api/outscraper-reviews', async (req, res) => {
  const { place_id, limit = 100, sort = 'newest' } = req.body;
  console.log(`[outscraper-reviews] Received request — place_id: ${place_id}, limit: ${limit}, sort: ${sort}`);

  if (!place_id) return res.status(400).json({ error: 'place_id is required.' });

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OUTSCRAPER_API_KEY is not set.' });

  try {
    // Submit async job using reviews-v3
    const query = encodeURIComponent(place_id);
    const submitUrl =
      `https://api.app.outscraper.com/maps/reviews-v3` +
      `?query=${query}&limit=${limit}&sort=${sort}&async=true`;
    console.log(`[outscraper-reviews] Calling Outscraper API: ${submitUrl}`);

    const submitResp = await fetch(submitUrl, { headers: { 'X-API-KEY': apiKey } });
    const submitText = await submitResp.text();
    console.log(`[outscraper-reviews] Outscraper response status: ${submitResp.status}`);
    console.log(`[outscraper-reviews] Outscraper response data: ${submitText.slice(0, 500)}`);

    if (!submitResp.ok) {
      throw new Error(`Outscraper submit failed (${submitResp.status}): ${submitText.slice(0, 200)}`);
    }

    let submitData;
    try { submitData = JSON.parse(submitText); } catch { throw new Error(`Outscraper non-JSON response: ${submitText.slice(0, 200)}`); }

    // If sync result already returned (status=Success), use it directly
    if (submitData?.status === 'Success' && Array.isArray(submitData.data)) {
      console.log('[outscraper-reviews] Got sync result immediately — no polling needed');
      const flat = submitData.data.flat();
      console.log('[outscraper-reviews] ALL KEYS on flat[0]:', flat[0] ? Object.keys(flat[0]).join(', ') : 'empty');
      console.log('[outscraper-reviews] FULL RAW flat[0]:', JSON.stringify(flat[0]).slice(0, 2000));
      const reviews = extractReviews(submitData.data);
      console.log(`[outscraper-reviews] done — ${reviews.length} reviews extracted`);
      return res.json({ reviews });
    }

    const requestId = submitData?.id;
    const resultsUrl = submitData?.results_location
      ?? `https://api.app.outscraper.com/requests/${requestId}`;
    if (!requestId && !submitData?.results_location) {
      throw new Error(`No request ID or results_location in Outscraper response: ${submitText.slice(0, 300)}`);
    }
    console.log(`[outscraper-reviews] Async job submitted — id: ${requestId}, polling: ${resultsUrl}`);

    for (let attempt = 1; attempt <= 12; attempt++) {
      await new Promise(r => setTimeout(r, 10000));
      const pollResp = await fetch(resultsUrl, { headers: { 'X-API-KEY': apiKey } });
      const pollText = await pollResp.text();
      if (!pollResp.ok) {
        console.log(`[outscraper-reviews] poll ${attempt} not ok (${pollResp.status}): ${pollText.slice(0, 200)}`);
        continue;
      }
      let pollData;
      try { pollData = JSON.parse(pollText); } catch {
        console.log(`[outscraper-reviews] poll ${attempt} non-JSON: ${pollText.slice(0, 200)}`);
        continue;
      }
      console.log(`[outscraper-reviews] poll ${attempt} — status: ${pollData?.status}, data items: ${Array.isArray(pollData?.data) ? pollData.data.flat().length : 'N/A'}`);

      if (pollData?.status === 'Success' && Array.isArray(pollData.data)) {
        const flat = pollData.data.flat();
        console.log(`[outscraper-reviews] flat length: ${flat.length}`);
        console.log('[outscraper-reviews] ALL KEYS on flat[0]:', flat[0] ? Object.keys(flat[0]).join(', ') : 'empty');
        console.log('[outscraper-reviews] FULL RAW flat[0]:', JSON.stringify(flat[0]).slice(0, 2000));
        const reviews = extractReviews(pollData.data);
        console.log(`[outscraper-reviews] done — ${reviews.length} reviews extracted`);
        return res.json({ reviews });
      }
    }

    throw new Error('Outscraper timed out after 2 minutes — please try again');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/outscraper-reviews]', message);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/google-places ─────────────────────────────────────────────────

app.get('/api/google-places', async (req, res) => {
  const { name, location } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'name query param is required.' });
  }

  const apiKey = process.env.GOOGLE_PLACES_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not set.' });
  }

  try {
    const query = encodeURIComponent(`${name} ${location || ''}`);
    const findUrl =
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${query}&inputtype=textquery&fields=place_id,name,rating,user_ratings_total&key=${apiKey}`;

    const findRes = await fetch(findUrl);
    const findData = await findRes.json();

    const candidate = findData.candidates?.[0];
    if (!candidate) {
      return res.json({ found: false });
    }

    res.json({
      found: true,
      name: candidate.name,
      rating: candidate.rating ?? null,
      reviewCount: candidate.user_ratings_total ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/google-places]', message);
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n  ✅ API server running at http://localhost:${PORT}`);
  console.log(`  ANTHROPIC_API_KEY:  ${process.env.ANTHROPIC_API_KEY  ? '✅ set' : '❌ MISSING'}`);
  console.log(`  GOOGLE_PLACES_KEY:  ${process.env.GOOGLE_PLACES_KEY  ? '✅ set' : '❌ MISSING'}`);
  console.log(`  OUTSCRAPER_API_KEY: ${process.env.OUTSCRAPER_API_KEY ? '✅ set' : '❌ MISSING'}\n`);
});
