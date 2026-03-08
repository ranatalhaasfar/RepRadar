import { extractReviews } from './_lib/shared.js';

// Polls up to 20 × 12 s = 240 s — within Vercel Pro's 300 s maxDuration.
// vercel.json must have "api/outscraper-reviews.js": { "maxDuration": 300 }

const REVIEWS_FETCH_LIMIT      = 200; // First-time fetch — own business
const MAX_REFRESH_FETCH        = 50;  // Weekly refresh — own business (keep low to save costs)
const COMPETITOR_REVIEWS_LIMIT = 200; // Reviews per competitor

const POLL_INTERVAL_MS = 12000; // 12 s between polls
const MAX_POLLS        = 20;    // 20 × 12 s = 240 s max wait

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { place_id, limit: rawLimit = REVIEWS_FETCH_LIMIT, sort = 'newest' } = req.body;

  // Enforce hard ceiling — caller cannot exceed REVIEWS_FETCH_LIMIT
  const limit = Math.min(Number(rawLimit) || REVIEWS_FETCH_LIMIT, REVIEWS_FETCH_LIMIT);
  console.log(`[outscraper-reviews] place_id: ${place_id}, requested limit: ${limit}, sort: ${sort}`);

  if (!place_id) return res.status(400).json({ error: 'place_id is required.' });

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OUTSCRAPER_API_KEY is not set.' });

  try {
    const query = encodeURIComponent(place_id);
    const submitUrl =
      `https://api.app.outscraper.com/maps/reviews-v3` +
      `?query=${query}&limit=${limit}&sort=${sort}&async=true`;
    console.log(`[outscraper-reviews] submitting: ${submitUrl}`);

    const submitResp = await fetch(submitUrl, { headers: { 'X-API-KEY': apiKey } });
    const submitText = await submitResp.text();
    console.log(`[outscraper-reviews] submit status=${submitResp.status} body=${submitText.slice(0, 500)}`);

    if (!submitResp.ok) {
      throw new Error(`Outscraper submit failed (${submitResp.status}): ${submitText.slice(0, 200)}`);
    }

    let submitData;
    try { submitData = JSON.parse(submitText); } catch { throw new Error(`Outscraper non-JSON: ${submitText.slice(0, 200)}`); }

    // Sync result — return immediately
    if (submitData?.status === 'Success' && Array.isArray(submitData.data)) {
      console.log('[outscraper-reviews] Got sync result immediately');
      return res.json({ reviews: processAndLog(submitData.data, limit) });
    }

    // Async job — poll
    const requestId = submitData?.id;
    const resultsUrl = submitData?.results_location
      ?? `https://api.app.outscraper.com/requests/${requestId}`;
    if (!requestId && !submitData?.results_location) {
      throw new Error(`No request ID or results_location in Outscraper response: ${submitText.slice(0, 300)}`);
    }
    console.log(`[outscraper-reviews] async job id=${requestId}, polling: ${resultsUrl} (max ${MAX_POLLS} polls × ${POLL_INTERVAL_MS / 1000}s)`);

    for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(resultsUrl, { headers: { 'X-API-KEY': apiKey } });
      const pollText = await pollResp.text();
      if (!pollResp.ok) {
        console.log(`[outscraper-reviews] poll ${attempt}/${MAX_POLLS} not ok (${pollResp.status}): ${pollText.slice(0, 200)}`);
        continue;
      }
      let pollData;
      try { pollData = JSON.parse(pollText); } catch {
        console.log(`[outscraper-reviews] poll ${attempt}/${MAX_POLLS} non-JSON: ${pollText.slice(0, 200)}`);
        continue;
      }
      console.log(`[outscraper-reviews] poll ${attempt}/${MAX_POLLS} status: ${pollData?.status}`);

      if (pollData?.status === 'Success' && Array.isArray(pollData.data)) {
        return res.json({ reviews: processAndLog(pollData.data, limit) });
      }
    }

    throw new Error(`Outscraper job did not complete after ${MAX_POLLS} polls (${MAX_POLLS * POLL_INTERVAL_MS / 1000}s). Please try again from your dashboard.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/outscraper-reviews]', message);
    res.status(500).json({ error: message });
  }
}

/**
 * Log raw Outscraper response structure, extract reviews, and return them.
 */
function processAndLog(dataArray, requestedLimit) {
  const flat = dataArray.flat();
  console.log(`[outscraper-reviews] raw data: ${dataArray.length} top-level items, ${flat.length} after flat()`);

  // Log per-place review counts if data is nested
  flat.forEach((item, i) => {
    if (Array.isArray(item?.reviews)) {
      console.log(`[outscraper-reviews]   place[${i}] "${item.name ?? item.title ?? '?'}" — ${item.reviews.length} reviews in .reviews[]`);
    } else if (typeof item?.review_text === 'string') {
      // flat review items — just log total
    } else {
      const reviewKey = Object.keys(item ?? {}).find(k =>
        Array.isArray(item[k]) && item[k][0] && ('review_text' in item[k][0] || 'text' in item[k][0])
      );
      if (reviewKey) {
        console.log(`[outscraper-reviews]   place[${i}] "${item.name ?? '?'}" — ${item[reviewKey].length} reviews at key "${reviewKey}"`);
      }
    }
  });

  console.log(`[outscraper-reviews] structure sample — first item keys: ${flat[0] ? Object.keys(flat[0]).join(', ') : 'empty'}`);
  if (flat[0]) {
    console.log(`[outscraper-reviews] FULL RAW flat[0]: ${JSON.stringify(flat[0]).slice(0, 2000)}`);
  }

  const reviews = extractReviews(dataArray);
  console.log(`[outscraper-reviews] requested=${requestedLimit}, Outscraper returned ${flat.length} items, extracted=${reviews.length} reviews`);
  return reviews;
}
