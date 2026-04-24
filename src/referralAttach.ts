import { FieldValue } from 'firebase-admin/firestore'
import { getDb } from './firebaseAdmin.js'
import { hasFirebaseAdminCredentials } from './firebaseAdmin.js'

function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Associa `referredByUid` ao comprador (uma vez), resolvendo o slug público do indicador.
 * Usado no checkout (planos premium) e no POST /referral/claim.
 */
export async function tryAttachReferralByProfileSlug(params: {
  buyerUid: string
  referralSlug: string
}): Promise<
  | { ok: true; attached: boolean; reason?: undefined }
  | { ok: false; reason: 'admin_unavailable' | 'invalid_slug' | 'unknown_slug' | 'self' | 'buyer_missing' }
> {
  if (!hasFirebaseAdminCredentials()) {
    return { ok: false, reason: 'admin_unavailable' }
  }
  const slug = normalizeSlug(params.referralSlug)
  if (!slug || slug.length > 120) {
    return { ok: false, reason: 'invalid_slug' }
  }
  const db = getDb()
  const idxRef = db.collection('profileSlugIndex').doc(slug)
  const buyerRef = db.collection('users').doc(params.buyerUid)

  try {
    const out = await db.runTransaction(async (tx) => {
      const idxSnap = await tx.get(idxRef)
      if (!idxSnap.exists) {
        return { kind: 'unknown_slug' as const }
      }
      const referrerUid = idxSnap.data()?.uid
      if (typeof referrerUid !== 'string' || !referrerUid.length) {
        return { kind: 'unknown_slug' as const }
      }
      if (referrerUid === params.buyerUid) {
        return { kind: 'self' as const }
      }
      const buyerSnap = await tx.get(buyerRef)
      if (!buyerSnap.exists) {
        return { kind: 'buyer_missing' as const }
      }
      const b = buyerSnap.data() ?? {}
      if (typeof b.referredByUid === 'string' && b.referredByUid.length > 0) {
        return { kind: 'noop' as const }
      }
      tx.set(
        buyerRef,
        {
          referredByUid: referrerUid,
          referredAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return { kind: 'attached' as const }
    })
    if (out.kind === 'attached') return { ok: true, attached: true }
    if (out.kind === 'noop') return { ok: true, attached: false }
    if (out.kind === 'self') return { ok: false, reason: 'self' }
    if (out.kind === 'buyer_missing') return { ok: false, reason: 'buyer_missing' }
    return { ok: false, reason: 'unknown_slug' }
  } catch (e) {
    console.error('[referralAttach]', e)
    return { ok: false, reason: 'unknown_slug' }
  }
}
