// outscraper-search.js
//
// Designed for Vercel Hobby (10s function limit).
// Each invocation does at most 2 polls × 2s = ~6s total, well within 10s.
// If the job isn't done, returns { pending: true, jobUrl } so the client
// can call again with ?jobUrl=... to continue polling.
//
// Modes:
//   GET ?name=...&city=...   → submit job, poll up to 2×, return result or pending
//   GET ?jobUrl=...          → poll once, return result or pending

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OUTSCRAPER_API_KEY is not set.' });

  // ── jobUrl mode: poll once ────────────────────────────────────────────────
  if (req.query.jobUrl) {
    const jobUrl = String(req.query.jobUrl);
    console.log(`[outscraper-search] polling jobUrl: ${jobUrl}`);
    try {
      const result = await pollOnce(jobUrl, apiKey);
      return res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Poll failed';
      console.error('[outscraper-search] poll error:', message);
      return res.status(500).json({ error: message });
    }
  }

  // ── submit mode ───────────────────────────────────────────────────────────
  const { name, city } = req.query;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  try {
    const query = encodeURIComponent(`${String(name)} ${String(city || '')}`.trim());
    const submitUrl = `https://api.app.outscraper.com/maps/search-v3?query=${query}&limit=1&async=true`;
    console.log(`[outscraper-search] submitting: ${submitUrl}`);

    const submitResp = await fetch(submitUrl, { headers: { 'X-API-KEY': apiKey } });
    const submitText = await submitResp.text();
    console.log(`[outscraper-search] submit status=${submitResp.status} body=${submitText.slice(0, 300)}`);

    if (!submitResp.ok) {
      throw new Error(`Outscraper submit failed (${submitResp.status}): ${submitText.slice(0, 300)}`);
    }

    let submitData;
    try { submitData = JSON.parse(submitText); }
    catch { throw new Error(`Non-JSON response: ${submitText.slice(0, 200)}`); }

    // Occasionally returns synchronously
    if (submitData?.status === 'Success' && Array.isArray(submitData.data)) {
      console.log('[outscraper-search] sync result');
      return res.json(extractPlace(submitData.data));
    }

    const jobUrl = submitData?.results_location;
    if (!jobUrl) throw new Error(`No results_location in response: ${submitText.slice(0, 300)}`);

    // Poll up to 2 times × 2s = 4s (leaves headroom within 10s limit)
    for (let i = 1; i <= 2; i++) {
      await sleep(2000);
      const result = await pollOnce(jobUrl, apiKey);
      console.log(`[outscraper-search] poll ${i}/2: ready=${!result.pending}`);
      if (!result.pending) return res.json(result);
    }

    // Still not done — tell the client to keep polling
    console.log(`[outscraper-search] not done after 2 polls, returning pending`);
    return res.json({ pending: true, jobUrl });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[outscraper-search] ERROR:', message);
    return res.status(500).json({ error: message });
  }
}

async function pollOnce(jobUrl, apiKey) {
  const resp = await fetch(jobUrl, { headers: { 'X-API-KEY': apiKey } });
  if (!resp.ok) return { pending: true, jobUrl };
  const data = await resp.json().catch(() => null);
  if (data?.status === 'Success' && Array.isArray(data.data)) {
    return extractPlace(data.data);
  }
  return { pending: true, jobUrl };
}

function extractPlace(dataArray) {
  const place = dataArray.flat()[0];
  if (!place) return { found: false };
  return {
    found:         true,
    place_id:      place.place_id ?? place.google_id ?? null,
    name:          place.name ?? null,
    full_address:  place.full_address ?? place.address ?? null,
    rating:        typeof place.rating === 'number' ? place.rating : null,
    reviews_count: typeof place.reviews === 'number' ? place.reviews : null,
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
