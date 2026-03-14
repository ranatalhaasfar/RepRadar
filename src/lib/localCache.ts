// ── localStorage cache helpers ────────────────────────────────────────────
//
// Keys:
//   repradar_insights_{businessId}   → { insights: Insight[], savedAt: number }
//   repradar_reviews_{businessId}    → { business: Business, reviews: Review[], savedAt: number }
//   repradar_categories_{businessId} → { categories: Category[], savedAt: number }

const PREFIX = 'repradar_'

function key(namespace: string, businessId: string) {
  return `${PREFIX}${namespace}_${businessId}`
}

export function lcSave<T>(namespace: string, businessId: string, data: T): void {
  try {
    localStorage.setItem(key(namespace, businessId), JSON.stringify({ data, savedAt: Date.now() }))
  } catch {
    // Ignore quota errors — localStorage is best-effort
  }
}

export function lcLoad<T>(namespace: string, businessId: string): { data: T; savedAt: number } | null {
  const k = key(namespace, businessId)
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data: T; savedAt: number }
    if (parsed == null || parsed.data == null) {
      localStorage.removeItem(k)
      return null
    }
    return parsed
  } catch {
    localStorage.removeItem(k)
    return null
  }
}

export function lcClear(namespace: string, businessId: string): void {
  try {
    localStorage.removeItem(key(namespace, businessId))
  } catch { /* ignore */ }
}

/** Clears ALL repradar_ keys — called on sign-out */
export function lcClearAll(): void {
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) toRemove.push(k)
    }
    toRemove.forEach(k => localStorage.removeItem(k))
  } catch { /* ignore */ }
}
