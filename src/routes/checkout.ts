import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import {
  asaasCreatePayment,
  asaasFindCustomersByEmail,
  asaasCreateCustomer,
  asaasUpdateCustomer,
} from '../asaasClient.js'
import { env } from '../config.js'
import { type AuthedRequest, requireFirebaseAuth } from '../middleware/firebaseAuth.js'
import {
  brlValue,
  isProductRef,
  productDescription,
  type ProductRef,
} from '../products.js'

const bodySchema = z.object({
  productRef: z.string().min(1),
  cpf: z.string().min(11).max(14),
})

function dueDatePlusDays(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Cliente Asaas só por email (sem Firestore — não precisa de conta de serviço). */
async function findOrCreateAsaasCustomer(params: {
  email: string
  name: string
  cpfCnpj: string
}): Promise<string> {
  const list = await asaasFindCustomersByEmail(params.email)
  if (list.length > 0) {
    const existing = list[0]!
    await asaasUpdateCustomer(existing.id, { cpfCnpj: params.cpfCnpj })
    return existing.id
  }
  const c = await asaasCreateCustomer({
    name: params.name,
    email: params.email,
    cpfCnpj: params.cpfCnpj,
  })
  return c.id
}

export const checkoutRouter = Router()

const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = (req as AuthedRequest).firebaseUid
    return uid ? `ck_${uid}` : req.ip ?? 'unknown'
  },
})

checkoutRouter.post(
  '/checkout',
  requireFirebaseAuth,
  checkoutLimiter,
  async (req, res) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() })
      return
    }
    const refRaw = parsed.data.productRef
    if (!isProductRef(refRaw)) {
      res.status(400).json({ error: 'unknown_product_ref' })
      return
    }
    const productRef: ProductRef = refRaw

    const ar = req as AuthedRequest
    const email = ar.firebaseEmail
    if (!email) {
      res.status(400).json({
        error: 'email_required',
        message: 'A conta precisa de email (ex.: login Google) para gerar cobrança.',
      })
      return
    }

    try {
      const customerId = await findOrCreateAsaasCustomer({
        email,
        name: ar.firebaseName ?? 'Cliente',
        cpfCnpj: parsed.data.cpf.replace(/\D/g, ''),
      })

      const externalReference = `${ar.firebaseUid}|${productRef}`
      const payment = await asaasCreatePayment({
        customerId,
        value: brlValue(productRef),
        description: productDescription(productRef),
        externalReference,
        dueDate: dueDatePlusDays(7),
        successUrl: env.CHECKOUT_SUCCESS_URL,
      })

      res.status(200).json({
        paymentId: payment.id,
        invoiceUrl: payment.invoiceUrl ?? null,
        bankSlipUrl: payment.bankSlipUrl ?? null,
        status: payment.status ?? null,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[checkout]', message)
      res.status(502).json({ error: 'checkout_failed', message })
    }
  },
)
