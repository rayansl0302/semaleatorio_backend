import type { NextFunction, Request, Response } from 'express'
import { verifyFirebaseIdToken } from '../verifyFirebaseIdToken.js'

export type AuthedRequest = Request & {
  firebaseUid: string
  firebaseEmail?: string
  firebaseName?: string
}

export async function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = req.headers.authorization
  if (!raw?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_bearer_token' })
    return
  }
  const token = raw.slice(7).trim()
  if (!token) {
    res.status(401).json({ error: 'empty_token' })
    return
  }
  try {
    const decoded = await verifyFirebaseIdToken(token)
    ;(req as AuthedRequest).firebaseUid = decoded.uid
    ;(req as AuthedRequest).firebaseEmail = decoded.email
    ;(req as AuthedRequest).firebaseName = decoded.name
    next()
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[firebaseAuth] verifyIdToken falhou:', e)
    }
    res.status(401).json({
      error: 'invalid_token',
      message:
        process.env.NODE_ENV !== 'production'
          ? 'Token inválido ou FIREBASE_PROJECT_ID no backend diferente de VITE_FIREBASE_PROJECT_ID no front.'
          : undefined,
    })
  }
}
