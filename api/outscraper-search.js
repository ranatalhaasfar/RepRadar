// Max polling: 10 attempts × 3 s = 30 s — within Vercel Pro's 60 s limit.
// Set maxDuration = 60 in vercel.json for this function.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, city } = req.query;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OUTSCRAPER_API_KEY is not set.' });

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
      if (!place) return res.json({ found: false });
      return res.json({
        found: true,
        place_id:     place.place_id ?? place.google_id ?? null,
        name:         place.name ?? null,
        full_address: place.full_address ?? place.address ?? null,
        rating:        typeof place.rating === 'number' ? place.rating : null,
        reviews_count: typeof place.reviews === 'number' ? place.reviews : null,
      });
    }

    // Async job — poll
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
          place_id:     place.place_id ?? place.google_id ?? null,
          name:         place.name ?? null,
          full_address: place.full_address ?? place.address ?? null,
          rating:        typeof place.rating === 'number' ? place.rating : null,
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
}
