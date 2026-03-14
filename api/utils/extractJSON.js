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
  return JSON.parse(jsonString)
}
