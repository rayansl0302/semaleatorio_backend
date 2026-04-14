import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { asaasGetPayment } from '../asaasClient.js'
import { coerceAmountBrl } from '../coerceAmountBrl.js'
import { hasFirebaseAdminCredentials, getDb } from '../firebaseAdmin.js'
import { type AuthedRequest, requireFirebaseAuth } from '../middleware/firebaseAuth.js'
import { isProductRef } from '../products.js'
import { parseExternalReference } from './webhookAsaas.js'

const batchBodySchema = z.object({
  /** Quantidade máxima de registos recentes a consultar no Asaas (1–500). */
  limit: z.number().int().min(1).max(500).optional(),
})

function amountsFromAsaasPayment(pay: Record<string, unknown>): {
  valueBrl: number | undefined
  netValueBrl: number | undefined
  billingType: string | undefined
} {
  const valueBrl =
    coerceAmountBrl(pay.value) ??
    coerceAmountBrl(pay.originalValue) ??
    coerceAmountBrl(pay.original_value)
  const netValueBrl =
    coerceAmountBrl(pay.netValue) ?? coerceAmountBrl(pay.net_value)
  const billingTypeRaw = pay.billingType ?? pay.billing_type
  const billingType =
    typeof billingTypeRaw === 'string' && billingTypeRaw.trim() !== ''
      ? billingTypeRaw.trim()
      : undefined
  return { valueBrl, netValueBrl, billingType }
}

async function assertGlobalAdmin(uid: string): Promise<boolean> {
  const snap = await getDb().collection('admins').doc(uid).get()
  return snap.exists && snap.data()?.role === 'global'
}

function externalRefMatchesDoc(
  externalReference: unknown,
  docUid: string | undefined,
  docProductRef: string | undefined,
): boolean {
  if (typeof externalReference !== 'string' || !externalReference.trim()) return true
  const raw = externalReference.trim()
  if (raw.includes('|')) {
    const p = parseExternalReference(raw)
    if (!p) return false
    return p.uid === docUid && p.productRef === docProductRef
  }
  if (isProductRef(raw)) {
    return raw === docProductRef
  }
  return true
}

type SyncOneResult = 'updated' | 'no_change' | 'skipped_ref' | 'asaas_error'

async function syncOneWebhookEventFromAsaas(
  paymentId: string,
  existing: Record<string, unknown>,
): Promise<SyncOneResult> {
  const docUid = typeof existing.uid === 'string' ? existing.uid : undefined
  const docProductRef =
    typeof existing.productRef === 'string' ? existing.productRef : undefined

  let pay: Record<string, unknown>
  try {
    pay = await asaasGetPayment(paymentId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[admin sync] Asaas get payment falhou', paymentId, msg)
    return 'asaas_error'
  }

  const apiId = typeof pay.id === 'string' ? pay.id : ''
  if (apiId && apiId !== paymentId) {
    return 'skipped_ref'
  }

  if (!externalRefMatchesDoc(pay.externalReference, docUid, docProductRef)) {
    return 'skipped_ref'
  }

  const { valueBrl, netValueBrl, billingType } = amountsFromAsaasPayment(pay)
  const patch: Record<string, unknown> = {}

  if (valueBrl != null && Number.isFinite(valueBrl)) {
    patch.value = Number(valueBrl)
    patch.valueFromCatalog = false
  }
  if (netValueBrl != null && Number.isFinite(netValueBrl)) {
    patch.netValue = Number(netValueBrl)
  }
  if (billingType) {
    patch.billingType = billingType
  }

  if (Object.keys(patch).length === 0) {
    return 'no_change'
  }

  const idemRef = getDb().collection('webhook_events').doc(paymentId)
  await idemRef.update(patch)
  console.log('[admin sync] webhook_events actualizado', paymentId, Object.keys(patch))
  return 'updated'
}

export const adminWebhookSyncRouter = Router()

const batchSyncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as AuthedRequest).firebaseUid
    return uid ? `admin_sync_batch_${uid}` : req.ip ?? 'unknown'
  },
})

adminWebhookSyncRouter.post(
  '/admin/sync-webhook-payments',
  requireFirebaseAuth,
  batchSyncLimiter,
  async (req, res) => {
    const ar = req as AuthedRequest
    if (!hasFirebaseAdminCredentials()) {
      res.status(503).json({
        error: 'firestore_admin_not_configured',
        message: 'FIREBASE_SERVICE_ACCOUNT_JSON em falta no servidor.',
      })
      return
    }

    const okAdmin = await assertGlobalAdmin(ar.firebaseUid)
    if (!okAdmin) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const parsed = batchBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() })
      return
    }

    const maxN = parsed.data.limit ?? 200
    const snap = await getDb()
      .collection('webhook_events')
      .orderBy('processedAt', 'desc')
      .limit(maxN)
      .get()

    let updated = 0
    let noChange = 0
    let skippedRef = 0
    let asaasError = 0

    for (const d of snap.docs) {
      const r = await syncOneWebhookEventFromAsaas(d.id, d.data() ?? {})
      if (r === 'updated') updated += 1
      else if (r === 'no_change') noChange += 1
      else if (r === 'skipped_ref') skippedRef += 1
      else asaasError += 1
    }

    console.log('[admin sync] lote concluído', {
      examined: snap.docs.length,
      updated,
      noChange,
      skippedRef,
      asaasError,
    })

    res.status(200).json({
      ok: true,
      examined: snap.docs.length,
      updated,
      noChange,
      skippedRef,
      asaasError,
    })
  },
)
