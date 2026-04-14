import { FieldValue, getDb, hasFirebaseAdminCredentials } from './firebaseAdmin.js'

const MAX_PAYLOAD_CHARS = 450_000

export type WebhookDeliveryOutcome =
  | 'ignored_no_payment_or_event'
  | 'ignored_unhandled_event'
  | 'ignored_bad_reference'
  | 'accepted_fulfillment'

/**
 * Arquivo permanente no Firestore de cada POST ao webhook Asaas (após token válido).
 * O painel Asaas só mantém histórico limitado (~14 dias); isto fica na vossa base.
 */
export async function persistAsaasWebhookDeliveryLog(params: {
  body: unknown
  outcome: WebhookDeliveryOutcome
  event?: string
  eventId?: string
  paymentId?: string
}): Promise<void> {
  if (!hasFirebaseAdminCredentials()) return

  let payloadJson = ''
  let payloadTruncated = false
  try {
    const s = JSON.stringify(params.body ?? null)
    if (s.length > MAX_PAYLOAD_CHARS) {
      payloadJson = s.slice(0, MAX_PAYLOAD_CHARS)
      payloadTruncated = true
    } else {
      payloadJson = s
    }
  } catch {
    payloadJson = '{"_error":"json_stringify_failed"}'
  }

  await getDb().collection('webhook_delivery_logs').add({
    receivedAt: FieldValue.serverTimestamp(),
    source: 'asaas',
    outcome: params.outcome,
    event: params.event ?? null,
    eventId: params.eventId ?? null,
    paymentId: params.paymentId ?? null,
    payloadJson,
    payloadTruncated,
  })
}
