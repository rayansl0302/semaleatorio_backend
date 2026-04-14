import { OAuth2Client } from 'google-auth-library'
import { env } from './config.js'

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

const client = new OAuth2Client()

let cachedCerts: Record<string, string> | null = null
let certsExpireAt = 0

async function getFirebaseCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < certsExpireAt) return cachedCerts

  const res = await fetch(FIREBASE_CERTS_URL)
  if (!res.ok) throw new Error(`Firebase certs fetch failed: ${res.status}`)

  cachedCerts = (await res.json()) as Record<string, string>

  const cc = res.headers.get('cache-control') ?? ''
  const m = cc.match(/max-age=(\d+)/)
  certsExpireAt = Date.now() + (m ? parseInt(m[1], 10) : 3600) * 1000

  return cachedCerts
}

export type VerifiedFirebaseUser = {
  uid: string
  email?: string
  name?: string
}

/**
 * Valida o ID token do Firebase Auth usando as chaves públicas do Firebase (securetoken).
 * Só precisa de FIREBASE_PROJECT_ID — sem JSON de conta de serviço.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<VerifiedFirebaseUser> {
  const certs = await getFirebaseCerts()
  const ticket = await client.verifySignedJwtWithCertsAsync(
    idToken,
    certs,
    env.FIREBASE_PROJECT_ID,
    [`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`],
  )
  const payload = ticket.getPayload()
  if (!payload?.sub) {
    throw new Error('Token sem subject (uid)')
  }
  return {
    uid: payload.sub,
    email: payload.email,
    name: payload.name,
  }
}
