// outscraper-search.js
// Two endpoints in one:
//   GET /api/outscraper-search?name=...&city=...        → submit job, return { jobId, resultsUrl } or sync { found, ... }
//   GET /api/outscraper-search?poll=1&resultsUrl=...    → poll once, return { ready, found, ... } or { ready: false }
//
// This avoids long-running serverless functions (Vercel Hobby = 10s max).
// The client does the polling loop instead.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OUTSCRAPER_API_KEY is not set.' });

  // ── Poll mode ─────────────────────────────────────────────────────────────
  if (req.query.poll === '1') {
    const { resultsUrl } = req.query;
    if (!resultsUrl) return res.status(400).json({ error: 'resultsUrl is required' });

    try {
      const pollResp = await fetch(resultsUrl, { headers: { 'X-API-KEY': apiKey } });
      const pollText = await pollResp.text();
      if (!pollResp.ok) return res.json({ ready: false });

      let pollData;
      try { pollData = JSON.parse(pollText); } catch { return res.json({ ready: false }); }

      if (pollData?.status === 'Success' && Array.isArray(pollData.data)) {
        const place = pollData.data.flat()[0];
        if (!place) return res.json({ ready: true, found: false });
        return res.json({
          ready: true,
          found: true,
          place_id:      place.place_id ?? place.google_id ?? null,
          name:          place.name ?? null,
          full_address:  place.full_address ?? place.address ?? null,
          rating:        typeof place.rating === 'number' ? place.rating : null,
          reviews_count: typeof place.reviews === 'number' ? place.reviews : null,
        });
      }

      // Still processing
      return res.json({ ready: false });
    } catch (e) {
      return res.json({ ready: false });
    }
  }

  // ── Submit mode ───────────────────────────────────────────────────────────
  const { name, city } = req.query;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  try {
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

    // Sync result — return immediately
    if (submitData?.status === 'Success' && Array.isArray(submitData.data)) {
      const place = submitData.data.flat()[0];
      if (!place) return res.json({ ready: true, found: false });
      console.log(`[outscraper-search] sync result: ${place.name}`);
      return res.json({
        ready: true,
        found: true,
        place_id:      place.place_id ?? place.google_id ?? null,
        name:          place.name ?? null,
        full_address:  place.full_address ?? place.address ?? null,
        rating:        typeof place.rating === 'number' ? place.rating : null,
        reviews_count: typeof place.reviews === 'number' ? place.reviews : null,
      });
    }

    // Async job — return the polling URL to the client
    const resultsUrl = submitData?.results_location;
    if (!resultsUrl) throw new Error('No results_location in Outscraper response');
    console.log(`[outscraper-search] async job, results_location=${resultsUrl}`);
    return res.json({ ready: false, resultsUrl });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/outscraper-search] ERROR:', message);
    res.status(500).json({ error: message });
  }
}
