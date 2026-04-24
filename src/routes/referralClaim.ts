import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { hasFirebaseAdminCredentials } from '../firebaseAdmin.js'
import { type AuthedRequest, requireFirebaseAuth } from '../middleware/firebaseAuth.js'
import { tryAttachReferralByProfileSlug } from '../referralAttach.js'

const bodySchema = z.object({
  slug: z.string().min(1).max(128),
})

export const referralClaimRouter = Router()

const referralClaimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as AuthedRequest).firebaseUid
    return uid ? `rf_claim_${uid}` : req.ip ?? 'unknown'
  },
})

referralClaimRouter.post(
  '/referral/claim',
  requireFirebaseAuth,
  referralClaimLimiter,
  async (req, res) => {
    if (!hasFirebaseAdminCredentials()) {
      res.status(503).json({
        error: 'firestore_admin_not_configured',
        message: 'Indicações precisam de FIREBASE_SERVICE_ACCOUNT_JSON no servidor.',
      })
      return
    }
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() })
      return
    }
    const ar = req as AuthedRequest
    const result = await tryAttachReferralByProfileSlug({
      buyerUid: ar.firebaseUid,
      referralSlug: parsed.data.slug,
    })
    if (!result.ok) {
      res.status(200).json({ ok: true, attached: false, reason: result.reason })
      return
    }
    res.status(200).json({ ok: true, attached: result.attached })
  },
)
