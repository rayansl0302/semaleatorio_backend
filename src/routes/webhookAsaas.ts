import crypto from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  asaasWebhookVerifyTokenCandidates,
  normalizeAsaasWebhookSecret,
} from '../config.js'
import { persistAsaasWebhookDeliveryLog } from '../asaasWebhookDeliveryLog.js'
import { hasFirebaseAdminCredentials } from '../firebaseAdmin.js'
import { applyPaymentFulfillmentOnce } from '../fulfillment.js'
import { isProductRef, type ProductRef } from '../products.js'
import { coerceAmountBrl } from '../coerceAmountBrl.js'
import { resolvePaymentLinkWebhook } from '../webhookPaymentLinkResolve.js'

type AsaasWebhookBody = {
  id?: string
  event?: string
  payment?: {
    id?: string
    externalReference?: string | null
    customer?: string | null
    status?: string
    /** Valor bruto em R$ (payload Asaas). */
    value?: unknown
    /** Valor líquido em R$ (payload Asaas). */
    netValue?: unknown
    billingType?: string | null
  }
}

const FULFILL_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'])

function incomingAsaasWebhookToken(req: import('express').Request): string {
  const raw = req.headers['asaas-access-token']
  const fromAsaasHeader =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw) && raw[0]
        ? String(raw[0])
        : ''
  if (fromAsaasHeader.length) {
    return normalizeAsaasWebhookSecret(fromAsaasHeader)
  }
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.length > 0) {
    return normalizeAsaasWebhookSecret(auth)
  }
  return ''
}

function verifyAsaasToken(req: import('express').Request): boolean {
  const token = incomingAsaasWebhookToken(req)
  if (!token.length) {
    return false
  }
  let a: Buffer
  try {
    a = Buffer.from(token, 'utf8')
  } catch {
    return false
  }
  for (const expected of asaasWebhookVerifyTokenCandidates()) {
    try {
      const b = Buffer.from(expected, 'utf8')
      if (a.length !== b.length) continue
      if (crypto.timingSafeEqual(a, b)) return true
    } catch {
      // continua para o próximo candidato
    }
  }
  return false
}

export function parseExternalReference(raw: string | null | undefined): {
  uid: string
  productRef: ProductRef
} | null {
  if (!raw || typeof raw !== 'string') return null
  const i = raw.indexOf('|')
  if (i <= 0 || i >= raw.length - 1) return null
  const uid = raw.slice(0, i)
  const pref = raw.slice(i + 1)
  if (!uid.length || !isProductRef(pref)) return null
  return { uid, productRef: pref }
}

export const webhookAsaasRouter = Router()

webhookAsaasRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
)

webhookAsaasRouter.post('/', async (req, res) => {
  if (!verifyAsaasToken(req)) {
    const got = incomingAsaasWebhookToken(req)
    const candidates = asaasWebhookVerifyTokenCandidates()
    console.warn('[webhook asaas] 401 invalid_webhook_token', {
      headerLen: got.length,
      expectedLengths: [...new Set(candidates.map((c) => c.length))],
      candidateCount: candidates.length,
    })
    res.status(401).json({ error: 'invalid_webhook_token' })
    return
  }

  const body = req.body as AsaasWebhookBody
  const event = body.event
  const eventId = body.id ?? ''
  const payment = body.payment
  const paymentId = payment?.id

  if (!event || !paymentId) {
    if (hasFirebaseAdminCredentials()) {
      void persistAsaasWebhookDeliveryLog({
        body,
        outcome: 'ignored_no_payment_or_event',
        event,
        eventId,
        paymentId,
      }).catch((e) => console.error('[webhook] falha ao gravar webhook_delivery_logs', e))
    }
    res.status(200).json({ received: true, ignored: true })
    return
  }

  if (!FULFILL_EVENTS.has(event)) {
    if (hasFirebaseAdminCredentials()) {
      void persistAsaasWebhookDeliveryLog({
        body,
        outcome: 'ignored_unhandled_event',
        event,
        eventId,
        paymentId,
      }).catch((e) => console.error('[webhook] falha ao gravar webhook_delivery_logs', e))
    }
    res.status(200).json({ received: true, ignored: true, event })
    return
  }

  let parsed = parseExternalReference(payment.externalReference ?? undefined)
  if (!parsed && hasFirebaseAdminCredentials()) {
    parsed = await resolvePaymentLinkWebhook({
      externalReference: payment.externalReference,
      customer: payment.customer,
    })
  }
  if (!parsed) {
    console.warn(
      '[webhook] não mapeado: esperado uid|PRODUCT_REF na cobrança API, ou link com PRODUCT_REF + customer Asaas com email = Firebase Auth',
      payment.externalReference,
      payment.customer,
    )
    if (hasFirebaseAdminCredentials()) {
      void persistAsaasWebhookDeliveryLog({
        body,
        outcome: 'ignored_bad_reference',
        event,
        eventId,
        paymentId,
      }).catch((e) => console.error('[webhook] falha ao gravar webhook_delivery_logs', e))
    }
    res.status(200).json({ received: true, ignored: true, reason: 'bad_reference' })
    return
  }

  if (!hasFirebaseAdminCredentials()) {
    console.error(
      '[webhook] FIREBASE_SERVICE_ACCOUNT_JSON em falta — não é possível atualizar o Firestore.',
    )
    res.status(503).json({
      error: 'firestore_admin_not_configured',
      message:
        'Define FIREBASE_SERVICE_ACCOUNT_JSON no backend para aplicar pagamentos ao perfil.',
    })
    return
  }

  res.status(200).json({ received: true })

  void persistAsaasWebhookDeliveryLog({
    body,
    outcome: 'accepted_fulfillment',
    event,
    eventId,
    paymentId,
  }).catch((e) => console.error('[webhook] falha ao gravar webhook_delivery_logs', e))

  const { uid, productRef } = parsed
  const pay = payment as Record<string, unknown>
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

  console.log('[webhook] montantes', {
    paymentId,
    valueBrl,
    netValueBrl,
    rawValue: pay.value,
    rawType: typeof pay.value,
  })

  if (valueBrl == null) {
    console.warn('[webhook] payment.value/originalValue em falta ou inválido', {
      paymentId,
      productRef,
      keys: Object.keys(pay),
    })
  }

  applyPaymentFulfillmentOnce({
    paymentId,
    eventId,
    event,
    uid,
    productRef,
    valueBrl,
    netValueBrl,
    billingType,
  }).catch((e) => console.error('[webhook] falha ao aplicar pagamento', paymentId, e))
})
