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
  try {
    const raw = localStorage.getItem(key(namespace, businessId))
    if (!raw) return null
    return JSON.parse(raw) as { data: T; savedAt: number }
  } catch {
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
