import { createHmac, timingSafeEqual } from 'node:crypto'

const PREFIX = 'v1'

export function signRiotOAuthState(uid: string, secret: string): string {
  const payload = {
    v: 1 as const,
    uid,
    exp: Date.now() + 15 * 60 * 1000,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${PREFIX}.${body}.${sig}`
}

export function verifyRiotOAuthState(
  state: string,
  secret: string,
): { uid: string } | null {
  try {
    const parts = state.split('.')
    if (parts.length !== 3 || parts[0] !== PREFIX) return null
    const body = parts[1]!
    const sig = parts[2]!
    const expected = createHmac('sha256', secret).update(body).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      v?: number
      uid?: string
      exp?: number
    }
    if (json.v !== 1 || typeof json.uid !== 'string' || typeof json.exp !== 'number') {
      return null
    }
    if (json.exp < Date.now()) return null
    return { uid: json.uid }
  } catch {
    return null
  }
}
