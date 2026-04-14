import crypto from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../config.js'
import { applyPaymentFulfillmentOnce } from '../fulfillment.js'
import { isProductRef, type ProductRef } from '../products.js'

type AsaasWebhookBody = {
  id?: string
  event?: string
  payment?: {
    id?: string
    externalReference?: string | null
    status?: string
  }
}

const FULFILL_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'])

function verifyAsaasToken(req: import('express').Request): boolean {
  const token = req.headers['asaas-access-token']
  if (typeof token !== 'string' || !token.length) {
    return false
  }
  try {
    const a = Buffer.from(token)
    const b = Buffer.from(env.ASAAS_WEBHOOK_TOKEN)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function parseExternalReference(raw: string | null | undefined): {
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
    res.status(401).json({ error: 'invalid_webhook_token' })
    return
  }

  const body = req.body as AsaasWebhookBody
  const event = body.event
  const eventId = body.id ?? ''
  const payment = body.payment
  const paymentId = payment?.id

  if (!event || !paymentId) {
    res.status(200).json({ received: true, ignored: true })
    return
  }

  if (!FULFILL_EVENTS.has(event)) {
    res.status(200).json({ received: true, ignored: true, event })
    return
  }

  const parsed = parseExternalReference(payment.externalReference ?? undefined)
  if (!parsed) {
    console.warn('[webhook] externalReference inválido', payment.externalReference)
    res.status(200).json({ received: true, ignored: true, reason: 'bad_reference' })
    return
  }

  try {
    await applyPaymentFulfillmentOnce({
      paymentId,
      eventId,
      event,
      uid: parsed.uid,
      productRef: parsed.productRef,
    })
    res.status(200).json({ received: true })
  } catch (e) {
    console.error('[webhook] falha ao aplicar pagamento', paymentId, e)
    res.status(500).json({ error: 'processing_failed' })
  }
})
