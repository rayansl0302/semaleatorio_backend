import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { asaasGetPayment } from '../asaasClient.js'
import { coerceAmountBrl } from '../coerceAmountBrl.js'
import { hasFirebaseAdminCredentials, getDb } from '../firebaseAdmin.js'
import { type AuthedRequest, requireFirebaseAuth } from '../middleware/firebaseAuth.js'
import { isProductRef } from '../products.js'
import { parseExternalReference } from './webhookAsaas.js'

const bodySchema = z.object({
  paymentId: z.string().min(1).max(128),
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

export const adminWebhookSyncRouter = Router()

const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as AuthedRequest).firebaseUid
    return uid ? `admin_sync_${uid}` : req.ip ?? 'unknown'
  },
})

adminWebhookSyncRouter.post(
  '/admin/sync-webhook-payment',
  requireFirebaseAuth,
  syncLimiter,
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

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() })
      return
    }

    const paymentId = parsed.data.paymentId.trim()
    const idemRef = getDb().collection('webhook_events').doc(paymentId)
    const docSnap = await idemRef.get()
    if (!docSnap.exists) {
      res.status(404).json({ error: 'webhook_doc_not_found' })
      return
    }

    const existing = docSnap.data() ?? {}
    const docUid = typeof existing.uid === 'string' ? existing.uid : undefined
    const docProductRef =
      typeof existing.productRef === 'string' ? existing.productRef : undefined

    let pay: Record<string, unknown>
    try {
      pay = await asaasGetPayment(paymentId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[admin sync] Asaas get payment falhou', paymentId, msg)
      res.status(502).json({
        error: 'asaas_fetch_failed',
        message: msg,
      })
      return
    }

    const apiId = typeof pay.id === 'string' ? pay.id : ''
    if (apiId && apiId !== paymentId) {
      res.status(409).json({ error: 'payment_id_mismatch' })
      return
    }

    if (!externalRefMatchesDoc(pay.externalReference, docUid, docProductRef)) {
      res.status(409).json({ error: 'payment_reference_mismatch' })
      return
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
      res.status(200).json({
        ok: true,
        updated: false,
        message: 'A API Asaas não devolveu valor, líquido ou método para actualizar.',
      })
      return
    }

    await idemRef.update(patch)
    console.log('[admin sync] webhook_events actualizado', paymentId, Object.keys(patch))
    res.status(200).json({ ok: true, updated: true })
  },
)
