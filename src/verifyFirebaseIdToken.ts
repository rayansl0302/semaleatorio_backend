import { OAuth2Client } from 'google-auth-library'
import { env } from './config.js'

const client = new OAuth2Client()

export type VerifiedFirebaseUser = {
  uid: string
  email?: string
  name?: string
}

/**
 * Valida o ID token do Firebase Auth usando as chaves públicas da Google.
 * Só precisa de FIREBASE_PROJECT_ID (o mesmo que VITE_FIREBASE_PROJECT_ID no front) — sem JSON de conta de serviço.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
): Promise<VerifiedFirebaseUser> {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.FIREBASE_PROJECT_ID,
  })
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
