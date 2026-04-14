import { coerceAmountBrl } from './coerceAmountBrl.js'
import { FieldValue, getDb, Timestamp } from './firebaseAdmin.js'
import {
  BOOST_1H_MS,
  BOOST_2H_MS,
  PREMIUM_MS,
  PRODUCT_REF,
  brlValue,
  type ProductRef,
} from './products.js'

function extendFrom(
  currentEndMs: number | undefined,
  addMs: number,
  now: number,
): Timestamp {
  const cur = currentEndMs ?? 0
  const base = Math.max(now, cur)
  return Timestamp.fromMillis(base + addMs)
}

/**
 * Idempotente por `paymentId`: grava `webhook_events/{paymentId}` e aplica benefício
 * na mesma transação (ou ignora se já processado).
 */
export async function applyPaymentFulfillmentOnce(params: {
  paymentId: string
  eventId: string
  event: string
  uid: string
  productRef: ProductRef
  /** Valor bruto em R$ (webhook Asaas). */
  valueBrl?: number
  /** Valor líquido em R$ (webhook Asaas). */
  netValueBrl?: number
  billingType?: string
}): Promise<{ applied: boolean }> {
  const db = getDb()
  const idemRef = db.collection('webhook_events').doc(params.paymentId)
  const userRef = db.collection('users').doc(params.uid)

  console.log('[fulfillment] aplicar', {
    paymentId: params.paymentId,
    uid: params.uid,
    productRef: params.productRef,
    event: params.event,
  })

  return db.runTransaction(async (tx) => {
    const idemSnap = await tx.get(idemRef)
    if (idemSnap.exists) {
      const existing = idemSnap.data() ?? {}
      const patch: Record<string, unknown> = {}
      const wasCatalog = existing.valueFromCatalog === true
      const curVal = coerceAmountBrl(existing.value)
      if (
        params.valueBrl != null &&
        Number.isFinite(params.valueBrl) &&
        (curVal === undefined ||
          wasCatalog ||
          Math.abs(curVal - params.valueBrl) > 1e-9)
      ) {
        patch.value = Number(params.valueBrl)
        patch.valueFromCatalog = false
      }
      const curNet = coerceAmountBrl(existing.netValue)
      if (
        params.netValueBrl != null &&
        Number.isFinite(params.netValueBrl) &&
        (curNet === undefined || Math.abs(curNet - params.netValueBrl) > 1e-9)
      ) {
        patch.netValue = Number(params.netValueBrl)
      }
      if (params.billingType && !existing.billingType) {
        patch.billingType = params.billingType
      }
      if (Object.keys(patch).length > 0) {
        tx.update(idemRef, patch)
        console.log('[fulfillment] idempotente — campos actualizados', params.paymentId, patch)
      } else {
        console.log('[fulfillment] já processado (idempotente)', params.paymentId)
      }
      return { applied: false }
    }

    const userSnap = await tx.get(userRef)
    if (!userSnap.exists) {
      throw new Error('user_not_found')
    }

    const data = userSnap.data()!
    const now = Date.now()
    const patch: Record<string, unknown> = {}

    if (
      params.productRef === PRODUCT_REF.premiumEssential ||
      params.productRef === PRODUCT_REF.premiumComplete
    ) {
      const variant =
        params.productRef === PRODUCT_REF.premiumEssential
          ? 'essential'
          : 'complete'
      const pu = data.premiumUntil as Timestamp | undefined
      patch.plan = 'premium'
      patch.premiumVariant = variant
      patch.premiumUntil = extendFrom(pu?.toMillis(), PREMIUM_MS, now)
    } else if (
      params.productRef === PRODUCT_REF.boost1h ||
      params.productRef === PRODUCT_REF.boost2h
    ) {
      const addMs =
        params.productRef === PRODUCT_REF.boost1h ? BOOST_1H_MS : BOOST_2H_MS
      const bu = data.boostUntil as Timestamp | undefined
      patch.boostUntil = extendFrom(bu?.toMillis(), addMs, now)
    }

    console.log('[fulfillment] patch a aplicar', params.uid, patch)

    const vWh = coerceAmountBrl(params.valueBrl)
    const valueFromWebhook = vWh != null && Number.isFinite(vWh)
    const valueStored = Number(valueFromWebhook ? vWh : brlValue(params.productRef))

    const webhookDoc: Record<string, unknown> = {
      eventId: params.eventId,
      event: params.event,
      uid: params.uid,
      productRef: params.productRef,
      processedAt: FieldValue.serverTimestamp(),
      value: valueStored,
      valueFromCatalog: !valueFromWebhook,
    }
    const nWh = coerceAmountBrl(params.netValueBrl)
    if (nWh != null && Number.isFinite(nWh)) webhookDoc.netValue = Number(nWh)
    if (params.billingType) webhookDoc.billingType = params.billingType

    if (!valueFromWebhook) {
      console.warn('[fulfillment] valor do webhook em falta — gravado preço de catálogo', {
        paymentId: params.paymentId,
        productRef: params.productRef,
        valueStored,
      })
    }

    tx.set(idemRef, webhookDoc)

    tx.set(userRef, patch, { merge: true })
    return { applied: true }
  })
}
