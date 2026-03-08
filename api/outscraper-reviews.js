import { extractReviews } from './_lib/shared.js';

// Polls up to 5 × 10 s = 50 s — within Vercel Pro's 60 s maxDuration.
// Set maxDuration = 60 in vercel.json for this function.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { place_id, limit = 100, sort = 'newest' } = req.body;
  console.log(`[outscraper-reviews] place_id: ${place_id}, limit: ${limit}, sort: ${sort}`);

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
      const flat = submitData.data.flat();
      console.log('[outscraper-reviews] ALL KEYS on flat[0]:', flat[0] ? Object.keys(flat[0]).join(', ') : 'empty');
      console.log('[outscraper-reviews] FULL RAW flat[0]:', JSON.stringify(flat[0]).slice(0, 2000));
      const reviews = extractReviews(submitData.data);
      console.log(`[outscraper-reviews] done — ${reviews.length} reviews extracted`);
      return res.json({ reviews });
    }

    // Async job — poll (max 5 attempts × 10 s = 50 s to stay under 60 s limit)
    const requestId = submitData?.id;
    const resultsUrl = submitData?.results_location
      ?? `https://api.app.outscraper.com/requests/${requestId}`;
    if (!requestId && !submitData?.results_location) {
      throw new Error(`No request ID or results_location in Outscraper response: ${submitText.slice(0, 300)}`);
    }
    console.log(`[outscraper-reviews] async job id: ${requestId}, polling: ${resultsUrl}`);

    for (let attempt = 1; attempt <= 5; attempt++) {
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
      console.log(`[outscraper-reviews] poll ${attempt} status: ${pollData?.status}`);

      if (pollData?.status === 'Success' && Array.isArray(pollData.data)) {
        const flat = pollData.data.flat();
        console.log('[outscraper-reviews] ALL KEYS on flat[0]:', flat[0] ? Object.keys(flat[0]).join(', ') : 'empty');
        console.log('[outscraper-reviews] FULL RAW flat[0]:', JSON.stringify(flat[0]).slice(0, 2000));
        const reviews = extractReviews(pollData.data);
        console.log(`[outscraper-reviews] done — ${reviews.length} reviews extracted`);
        return res.json({ reviews });
      }
    }

    throw new Error('Outscraper timed out — the job is still processing. Please try fetching reviews again from your dashboard.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/outscraper-reviews]', message);
    res.status(500).json({ error: message });
  }
}
