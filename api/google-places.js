export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, location } = req.query;
  if (!name) return res.status(400).json({ error: 'name query param is required.' });

  const apiKey = process.env.GOOGLE_PLACES_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not set.' });

  try {
    const query = encodeURIComponent(`${name} ${location || ''}`);
    const findUrl =
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${query}&inputtype=textquery&fields=place_id,name,rating,user_ratings_total&key=${apiKey}`;

    const findRes = await fetch(findUrl);
    const findData = await findRes.json();

    const candidate = findData.candidates?.[0];
    if (!candidate) return res.json({ found: false });

    res.json({
      found: true,
      name:        candidate.name,
      rating:      candidate.rating ?? null,
      reviewCount: candidate.user_ratings_total ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/google-places]', message);
    res.status(500).json({ error: message });
  }
}
