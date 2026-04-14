import { asaasGetCustomer } from './asaasClient.js'
import { getFirebaseUidByEmail } from './firebaseAdmin.js'
import { isProductRef, type ProductRef } from './products.js'

/**
 * Cobrança gerada por **link de pagamento**: `externalReference` = só `PRODUCT_REF` (sem uid).
 * Obtém o email do cliente no Asaas e encontra o uid em Firebase Auth (`getUserByEmail`).
 * O utilizador deve usar no checkout Asaas o **mesmo email** com que fez login na app.
 */
export async function resolvePaymentLinkWebhook(params: {
  externalReference?: string | null
  customer?: string | null
}): Promise<{ uid: string; productRef: ProductRef } | null> {
  const ref = params.externalReference?.trim()
  if (!ref || !isProductRef(ref)) return null
  if (ref.includes('|')) return null

  const customerId = params.customer
  if (typeof customerId !== 'string' || !customerId.length) return null

  try {
    const cust = await asaasGetCustomer(customerId)
    const email = cust.email?.trim()
    if (!email) {
      console.warn('[webhook] cliente Asaas sem email', customerId)
      return null
    }
    const uid = await getFirebaseUidByEmail(email)
    if (!uid) {
      console.warn(
        '[webhook] email do pagador Asaas não existe no Firebase Auth (usa o mesmo email da conta Google/etc.)',
        email.toLowerCase(),
      )
      return null
    }
    return { uid, productRef: ref }
  } catch (e) {
    console.error('[webhook] falha ao resolver link de pagamento', e)
    return null
  }
}
