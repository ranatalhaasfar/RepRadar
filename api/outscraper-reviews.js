import { extractReviews, getSupabase, checkPlanAccess } from './_lib/shared.js';

// Single call with reviewsLimit=200 — Outscraper reviews-v3 uses reviewsLimit
// (not limit) for the number of reviews. limit=1 means fetch 1 place.
// vercel.json: "api/outscraper-reviews.js": { "maxDuration": 300 }

const POLL_INTERVAL = 12000; // 12 s between polls
const MAX_POLLS     = 10;   // 10 × 12 s = 120 s per job

const REVIEWS_FETCH_LIMIT      = 200;
const COMPETITOR_REVIEWS_LIMIT = 50;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    place_id,
    sort = 'newest',
    competitor = false,  // When true: single 50-review fetch
    user_id,
  } = req.body;

  if (!place_id) return res.status(400).json({ error: 'place_id is required.' });

  const { isPaid } = await checkPlanAccess(getSupabase(), user_id);
  if (!isPaid) return res.status(403).json({ error: 'upgrade_required', message: 'This feature requires a paid plan.' });

  // Guard: only valid Google Place IDs (always start with "ChIJ") reach Outscraper
  if (typeof place_id !== 'string' || !place_id.startsWith('ChIJ')) {
    console.error('[outscraper-reviews] BLOCKED — invalid place_id:', place_id);
    return res.status(400).json({ error: 'Invalid business ID — cannot fetch reviews.' });
  }

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OUTSCRAPER_API_KEY is not set.' });

  // ── Competitor mode: single call, 50 reviews ─────────────────────────────
  if (competitor) {
    console.log(`[outscraper-reviews] COMPETITOR mode — reviewsLimit=${COMPETITOR_REVIEWS_LIMIT}`);
    try {
      const reviews = await runJob(place_id, COMPETITOR_REVIEWS_LIMIT, 'newest', apiKey);
      console.log(`[outscraper-reviews] reviewsLimit=${COMPETITOR_REVIEWS_LIMIT} — got ${reviews.length} reviews back`);
      return res.json({ reviews });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[/api/outscraper-reviews] competitor mode error:', message);
      return res.status(500).json({ error: message });
    }
  }

  // ── Main business mode: single call, reviewsLimit=200 ────────────────────
  // FIX: was using limit= (controls number of places, default 1) instead of
  // reviewsLimit= (controls number of reviews). This is why we were capped at 100.
  console.log(`[outscraper-reviews] MAIN BUSINESS mode — reviewsLimit=${REVIEWS_FETCH_LIMIT}`);

  try {
    const reviews = await runJob(place_id, REVIEWS_FETCH_LIMIT, sort, apiKey);
    console.log(`[outscraper-reviews] reviewsLimit=${REVIEWS_FETCH_LIMIT} — got ${reviews.length} reviews back`);
    return res.json({ reviews, meta: { total: reviews.length } });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/outscraper-reviews]', message);
    res.status(500).json({ error: message });
  }
}

/**
 * Submit one Outscraper async job and poll until Success. Returns extracted reviews.
 * reviewsLimit = number of reviews to fetch (correct param name for reviews-v3)
 * limit=1      = number of places to query (we always query exactly 1 place)
 */
async function runJob(place_id, reviewsLimit, sort, apiKey) {
  const query = encodeURIComponent(place_id);
  const url =
    `https://api.app.outscraper.com/maps/reviews-v3` +
    `?query=${query}&reviewsLimit=${reviewsLimit}&limit=1&sort=${sort}&async=true`;
  console.log(`[outscraper-reviews] submitting: ${url}`);

  const submitResp = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
  const submitText = await submitResp.text();
  console.log(`[outscraper-reviews] submit status=${submitResp.status} body=${submitText.slice(0, 400)}`);

  if (!submitResp.ok) {
    throw new Error(`Outscraper submit failed (${submitResp.status}): ${submitText.slice(0, 200)}`);
  }

  let submitData;
  try { submitData = JSON.parse(submitText); }
  catch { throw new Error(`Outscraper non-JSON response: ${submitText.slice(0, 200)}`); }

  // Synchronous result — occasionally returned immediately
  if (submitData?.status === 'Success' && Array.isArray(submitData.data)) {
    console.log('[outscraper-reviews] sync result received immediately');
    return extractAndLog(submitData.data, reviewsLimit);
  }

  // Async polling
  const requestId = submitData?.id;
  const resultsUrl = submitData?.results_location
    ?? `https://api.app.outscraper.com/requests/${requestId}`;

  if (!requestId && !submitData?.results_location) {
    throw new Error(`No request ID in Outscraper response: ${submitText.slice(0, 300)}`);
  }
  console.log(`[outscraper-reviews] job id=${requestId} polling ${resultsUrl} (max ${MAX_POLLS} × ${POLL_INTERVAL / 1000}s)`);

  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const pollResp = await fetch(resultsUrl, { headers: { 'X-API-KEY': apiKey } });
    const pollText = await pollResp.text();

    if (!pollResp.ok) {
      console.log(`[outscraper-reviews] poll ${attempt}/${MAX_POLLS} not ok (${pollResp.status}): ${pollText.slice(0, 200)}`);
      continue;
    }

    let pollData;
    try { pollData = JSON.parse(pollText); }
    catch {
      console.log(`[outscraper-reviews] poll ${attempt}/${MAX_POLLS} non-JSON: ${pollText.slice(0, 200)}`);
      continue;
    }

    console.log(`[outscraper-reviews] poll ${attempt}/${MAX_POLLS} status=${pollData?.status}`);

    if (pollData?.status === 'Success' && Array.isArray(pollData.data)) {
      return extractAndLog(pollData.data, reviewsLimit);
    }
  }

  throw new Error(
    `Outscraper job did not complete after ${MAX_POLLS} polls (${MAX_POLLS * POLL_INTERVAL / 1000}s). Please try again.`
  );
}

/**
 * Log raw response structure, extract reviews, and return them.
 */
function extractAndLog(dataArray, reviewsLimit) {
  const flat = dataArray.flat().filter(item => item !== null && typeof item === 'object');
  console.log(`[outscraper-reviews] raw: ${dataArray.length} top-level, ${flat.length} after flat()+filter`);

  flat.forEach((item, i) => {
    if (Array.isArray(item?.reviews)) {
      console.log(`[outscraper-reviews]   place[${i}] "${item.name ?? '?'}" — ${item.reviews.length} reviews in .reviews[]`);
    } else {
      const reviewKey = Object.keys(item ?? {}).find(k =>
        Array.isArray(item[k]) && item[k][0] &&
        typeof item[k][0] === 'object' &&
        ('review_text' in item[k][0] || 'text' in item[k][0])
      );
      if (reviewKey) {
        console.log(`[outscraper-reviews]   place[${i}] "${item.name ?? '?'}" — ${item[reviewKey].length} reviews at key "${reviewKey}"`);
      }
    }
  });

  if (flat[0]) {
    console.log(`[outscraper-reviews] first-item keys: ${Object.keys(flat[0]).join(', ')}`);
    console.log(`[outscraper-reviews] FULL RAW flat[0]: ${JSON.stringify(flat[0]).slice(0, 1500)}`);
  }

  const reviews = extractReviews(dataArray);
  console.log(`[outscraper-reviews] reviewsLimit=${reviewsLimit}, extracted=${reviews.length} reviews`);
  return reviews;
}
