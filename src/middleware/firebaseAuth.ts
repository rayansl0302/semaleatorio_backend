import type { NextFunction, Request, Response } from 'express'
import { getFirebaseAuth } from '../firebaseAdmin.js'

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
    const decoded = await getFirebaseAuth().verifyIdToken(token)
    ;(req as AuthedRequest).firebaseUid = decoded.uid
    ;(req as AuthedRequest).firebaseEmail = decoded.email
    ;(req as AuthedRequest).firebaseName = decoded.name
    next()
  } catch {
    res.status(401).json({ error: 'invalid_token' })
  }
}
