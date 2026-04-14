import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { env } from './config.js'

let app: App | null = null

/** Só necessário para webhook Asaas (e Riot SSO que grava Firestore). Checkout não usa. */
export function hasFirebaseAdminCredentials(): boolean {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim())
}

export function getFirebaseApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!
  }
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON não definido — obrigatório para o webhook Asaas atualizar planos no Firestore (e para Riot SSO gravar perfil). O checkout só precisa de FIREBASE_PROJECT_ID.',
    )
  }
  const json = JSON.parse(raw) as Record<string, unknown>
  app = initializeApp({
    credential: cert(json as Parameters<typeof cert>[0]),
  })
  return app
}

export function getDb() {
  return getFirestore(getFirebaseApp())
}

/** Webhook Asaas (link de pagamento): email do cliente Asaas → uid Firebase Auth. */
export async function getFirebaseUidByEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  try {
    const user = await getAuth(getFirebaseApp()).getUserByEmail(normalized)
    return user.uid
  } catch (e: unknown) {
    const code =
      e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
    if (code === 'auth/user-not-found') return null
    throw e
  }
}

export { FieldValue, Timestamp }
