import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { env } from './config.js'

let app: App

export function getFirebaseApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!
  }
  const json = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as Record<
    string,
    unknown
  >
  app = initializeApp({
    credential: cert(json as Parameters<typeof cert>[0]),
  })
  return app
}

export function getDb() {
  getFirebaseApp()
  return getFirestore()
}

export function getFirebaseAuth() {
  getFirebaseApp()
  return getAuth()
}

export { FieldValue, Timestamp }
