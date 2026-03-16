// outscraper-search.js
// Uses async=false to get a synchronous result from Outscraper in one call.
// Falls back to client-side polling if Outscraper returns an async job anyway.
// Two modes:
//   GET ?name=...&city=...        → submit, return result or { ready:false, resultsUrl }
//   GET ?poll=1&resultsUrl=...    → poll once, return { ready, ...place }

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
      const pollResp = await fetch(String(resultsUrl), { headers: { 'X-API-KEY': apiKey } });
      if (!pollResp.ok) return res.json({ ready: false });
      const pollData = await pollResp.json().catch(() => null);
      if (pollData?.status === 'Success' && Array.isArray(pollData.data)) {
        return res.json(extractPlace(pollData.data));
      }
      return res.json({ ready: false });
    } catch {
      return res.json({ ready: false });
    }
  }

  // ── Submit mode ───────────────────────────────────────────────────────────
  const { name, city } = req.query;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  try {
    const query = encodeURIComponent(`${String(name)} ${String(city || '')}`.trim());
    // async=false: Outscraper blocks until done (usually 2-8s, within 15s maxDuration)
    const url = `https://api.app.outscraper.com/maps/search-v3?query=${query}&limit=1&async=false`;
    console.log(`[outscraper-search] GET ${url}`);

    const resp = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
    const text = await resp.text();
    console.log(`[outscraper-search] status=${resp.status} body=${text.slice(0, 400)}`);

    if (!resp.ok) {
      throw new Error(`Outscraper error (${resp.status}): ${text.slice(0, 300)}`);
    }

    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}`); }

    // Sync success
    if (data?.status === 'Success' && Array.isArray(data.data)) {
      return res.json(extractPlace(data.data));
    }

    // Outscraper returned an async job anyway — give client the polling URL
    const resultsUrl = data?.results_location;
    if (resultsUrl) {
      console.log(`[outscraper-search] async fallback, polling url: ${resultsUrl}`);
      return res.json({ ready: false, resultsUrl });
    }

    throw new Error(`Unexpected Outscraper response: ${text.slice(0, 300)}`);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[outscraper-search] ERROR:', message);
    return res.status(500).json({ error: message });
  }
}

function extractPlace(dataArray) {
  const place = dataArray.flat()[0];
  if (!place) return { ready: true, found: false };
  return {
    ready:         true,
    found:         true,
    place_id:      place.place_id ?? place.google_id ?? null,
    name:          place.name ?? null,
    full_address:  place.full_address ?? place.address ?? null,
    rating:        typeof place.rating === 'number' ? place.rating : null,
    reviews_count: typeof place.reviews === 'number' ? place.reviews : null,
  };
}
