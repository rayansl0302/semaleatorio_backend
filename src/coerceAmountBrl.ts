/** Normaliza montante do webhook Asaas / Firestore (número, string regional, etc.). */
export function coerceAmountBrl(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = v.trim().replace(/\s/g, '').replace(',', '.')
    if (!t) return undefined
    const n = Number(t)
    if (Number.isFinite(n)) return n
  }
  return undefined
}
