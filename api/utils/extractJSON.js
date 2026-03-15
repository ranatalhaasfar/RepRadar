export function extractJSON(text) {
  if (!text) throw new Error('Empty response from AI')

  // Remove ALL markdown code fences
  let cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  // Find the JSON array boundaries
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')

  if (start === -1 || end === -1) {
    throw new Error('No JSON array found in response')
  }

  const jsonString = cleaned.substring(start, end + 1)
  return JSON.parse(jsonString)
}

export function extractJSONObject(text) {
  if (!text) throw new Error('Empty response from AI')

  // Remove ALL markdown code fences
  let cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  // Find the JSON object boundaries
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')

  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in response')
  }

  const jsonString = cleaned.substring(start, end + 1)

  // First attempt: parse as-is
  try {
    return JSON.parse(jsonString)
  } catch {
    // Second attempt: strip control characters and invalid Unicode that break JSON.parse
    const repaired = jsonString
      .replace(/[\u0000-\u001F\u007F]/g, ' ')  // control chars → space
      .replace(/[\uD800-\uDFFF]/g, '')           // lone surrogates
      .replace(/,\s*([}\]])/g, '$1')             // trailing commas
    try {
      return JSON.parse(repaired)
    } catch (e2) {
      throw new Error(`JSON parse failed after repair attempt: ${e2.message}`)
    }
  }
}
