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
    // Build numbered list — include ALL reviews (up to 200)
    const reviewList = reviews
      .map((r, i) => {
        const stars = r.rating ? `${r.rating}★` : 'no rating';
        const text  = r.review_text?.trim() || '(no written review)';
        return `${i}. [${stars}] ${text}`;
      })
      .join('\n');

    const client = getClient();
    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: `You are a review analysis expert. Analyze the provided customer reviews and identify 5–8 distinct categories that are genuinely relevant to THIS specific business based on what customers actually mention.

CRITICAL RULES:
1. Every review index (0 to ${reviews.length - 1}) MUST appear in at least one category's reviewIndices.
2. A review may appear in multiple categories if relevant.
3. reviewIndices must be 0-based integers matching the review numbers in the input.
4. "review_count" must equal the length of reviewIndices for that category.

Return ONLY a JSON array (no markdown, no explanation) with objects shaped exactly like this:
{
  "name": "Category Name",
  "emoji": "🔧",
  "review_count": 12,
  "sentiment_score": 0.75,
  "verdict": "Strength",
  "example_snippets": ["short quote 1", "short quote 2"],
  "reviewIndices": [0, 3, 7, 12, 15]
}

Rules:
- "verdict" must be exactly one of: "Strength", "Needs Improvement", "Critical Issue"
- "sentiment_score" is a float from -1.0 (very negative) to 1.0 (very positive)
- "review_count" must equal reviewIndices.length
- "example_snippets" must be 1–3 short direct quotes (max ~15 words each) from the actual reviews
- "reviewIndices" is a list of 0-based review indices that belong to this category
- ALL ${reviews.length} review indices (0–${reviews.length - 1}) must be covered across all categories
- Categories must reflect real patterns in the data — do not invent generic categories
- Order by review_count descending`,
      messages: [
        {
          role: 'user',
          content: `Here are ${reviews.length} customer reviews (0-indexed). Identify 5–8 key categories and assign EVERY review to at least one category:\n\n${reviewList}`,
        },
      ],
    });

    const raw = message.content[0]?.text ?? '';
    // Strip markdown code fences anywhere in the response, then extract the JSON array
    let clean = raw
      .replace(/```(?:json)?/gi, '')
      .trim();
    // If the response has prose before/after the array, extract just the array
    const arrayStart = clean.indexOf('[');
    const arrayEnd   = clean.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
      clean = clean.slice(arrayStart, arrayEnd + 1);
    }

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
