// Shared hook for Outscraper business search with client-side polling.
// Handles the pending/jobUrl relay pattern to stay within Vercel's 10s limit.

export type SearchResult = {
  place_id:      string
  name:          string
  full_address:  string | null
  rating:        number | null
  reviews_count: number | null
}

const MAX_CLIENT_POLLS = 8
const CLIENT_POLL_INTERVAL = 4000 // 4s between client-initiated calls

export async function searchBusiness(
  name: string,
  city: string,
  onProgress?: (msg: string) => void,
): Promise<SearchResult | null> {
  onProgress?.('Searching Google Maps…')

  // 1. Submit
  const params = new URLSearchParams({ name: name.trim(), city: city.trim() })
  const res = await fetch(`/api/outscraper-search?${params}`)
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error ?? `Search failed (${res.status})`)
  }
  const data = await res.json()

  // 2. Immediate result
  if (!data.pending) {
    return data.found ? (data as SearchResult) : null
  }

  // 3. Client-side polling relay
  let jobUrl: string = data.jobUrl
  for (let i = 1; i <= MAX_CLIENT_POLLS; i++) {
    onProgress?.(`Still searching… (${i}/${MAX_CLIENT_POLLS})`)
    await sleep(CLIENT_POLL_INTERVAL)

    const pollParams = new URLSearchParams({ jobUrl })
    const pollRes = await fetch(`/api/outscraper-search?${pollParams}`)
    if (!pollRes.ok) continue

    const pollData = await pollRes.json().catch(() => null)
    if (!pollData) continue

    if (pollData.error) throw new Error(pollData.error)

    if (!pollData.pending) {
      return pollData.found ? (pollData as SearchResult) : null
    }

    // Server returned pending again with a (possibly updated) jobUrl
    if (pollData.jobUrl) jobUrl = pollData.jobUrl
  }

  throw new Error('Search timed out. Please try again.')
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
