import { getClient } from './_lib/shared.js';
import { extractJSONObject } from './utils/extractJSON.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reviews } = req.body;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'reviews array is required.' });
  }

  try {
    const numbered = reviews.map((r, i) => `${i + 1}. ${r}`).join('\n');

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
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

    const data = extractJSONObject(response.content[0].type === 'text' ? response.content[0].text : '')
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/analyze-reviews]', message);
    res.status(500).json({ error: message });
  }
}
