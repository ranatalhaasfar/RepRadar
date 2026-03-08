export default function handler(req, res) {
  res.json({
    ok: true,
    anthropicKeySet:    !!process.env.ANTHROPIC_API_KEY,
    googlePlacesKeySet: !!process.env.GOOGLE_PLACES_KEY,
    outscraperKeySet:   !!process.env.OUTSCRAPER_API_KEY,
  });
}
