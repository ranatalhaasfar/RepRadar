import { getClient } from './_lib/shared.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reviews } = req.body;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: 'reviews array is required.' });
  }

  try {
    // Cap at 30 reviews to keep prompt size reasonable
    const sample = reviews.slice(0, 30);
    const reviewList = sample
      .map((r, i) => {
        const stars = r.rating ? `${r.rating}★` : 'no rating';
        return `${i + 1}. [${stars}] ${r.review_text}`;
      })
      .join('\n');

    const client = getClient();
    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: `You are a review analysis expert. Analyze the provided customer reviews and identify 5–8 distinct categories that are genuinely relevant to THIS specific business based on what customers actually mention.

Return ONLY a JSON array (no markdown, no explanation) with objects shaped exactly like this:
{
  "name": "Category Name",
  "emoji": "🔧",
  "review_count": 12,
  "sentiment_score": 0.75,
  "verdict": "Strength",
  "example_snippets": ["short quote 1", "short quote 2", "short quote 3"]
}

Rules:
- "verdict" must be exactly one of: "Strength", "Needs Improvement", "Critical Issue"
- "sentiment_score" is a float from -1.0 (very negative) to 1.0 (very positive)
- "review_count" is the number of reviews that mention this category
- "example_snippets" must be 1–3 short direct quotes (max ~15 words each) from the actual reviews
- Categories must reflect real patterns in the data — do not invent generic categories
- Order by review_count descending`,
      messages: [
        {
          role: 'user',
          content: `Here are ${sample.length} customer reviews. Identify the key categories:\n\n${reviewList}`,
        },
      ],
    });

    const raw = message.content[0]?.text ?? '';
    const clean = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      throw new Error(`AI returned non-JSON: ${clean.slice(0, 300)}`);
    }

    // Normalise: handle both bare array [...] and wrapped { categories: [...] }
    const categories = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.categories)
        ? parsed.categories
        : null;

    if (!categories) {
      throw new Error(`Unexpected AI response shape: ${clean.slice(0, 300)}`);
    }

    return res.json({ categories });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/generate-categories]', message);
    res.status(500).json({ error: message });
  }
}
