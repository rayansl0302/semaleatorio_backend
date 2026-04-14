import { asaasApiKey, asaasBaseUrl } from './config.js'

type AsaasCustomer = {
  id: string
  email?: string
}

type AsaasListResponse<T> = {
  data?: T[]
}

type PaymentCreateResponse = {
  id: string
  invoiceUrl?: string
  bankSlipUrl?: string
  status?: string
}

function headers(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    access_token: asaasApiKey(),
  }
}

export async function asaasGetCustomer(id: string): Promise<AsaasCustomer> {
  const res = await fetch(`${asaasBaseUrl()}/v3/customers/${encodeURIComponent(id)}`, {
    headers: headers(),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Asaas get customer: ${res.status} ${t}`)
  }
  return (await res.json()) as AsaasCustomer
}

export async function asaasFindCustomersByEmail(
  email: string,
): Promise<AsaasCustomer[]> {
  const u = new URL(`${asaasBaseUrl()}/v3/customers`)
  u.searchParams.set('email', email)
  const res = await fetch(u.toString(), { headers: headers() })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Asaas list customers: ${res.status} ${t}`)
  }
  const body = (await res.json()) as AsaasListResponse<AsaasCustomer>
  return body.data ?? []
}

export async function asaasUpdateCustomer(
  id: string,
  params: { cpfCnpj?: string },
): Promise<void> {
  const res = await fetch(
    `${asaasBaseUrl()}/v3/customers/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(params),
    },
  )
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Asaas update customer: ${res.status} ${t}`)
  }
}

export async function asaasCreateCustomer(params: {
  name: string
  email: string
  cpfCnpj: string
}): Promise<AsaasCustomer> {
  const res = await fetch(`${asaasBaseUrl()}/v3/customers`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      cpfCnpj: params.cpfCnpj,
      notificationDisabled: false,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Asaas create customer: ${res.status} ${t}`)
  }
  return (await res.json()) as AsaasCustomer
}

export async function asaasCreatePayment(params: {
  customerId: string
  value: number
  description: string
  externalReference: string
  dueDate: string
  successUrl?: string
}): Promise<PaymentCreateResponse> {
  const body: Record<string, unknown> = {
    customer: params.customerId,
    billingType: 'UNDEFINED',
    value: params.value,
    dueDate: params.dueDate,
    description: params.description,
    externalReference: params.externalReference,
  }
  if (params.successUrl) {
    body.callback = {
      successUrl: params.successUrl,
      autoRedirect: true,
    }
  }
  const res = await fetch(`${asaasBaseUrl()}/v3/payments`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Asaas create payment: ${res.status} ${t}`)
  }
  return (await res.json()) as PaymentCreateResponse
}

/** Cobrança única (GET /v3/payments/:id) — mesmo formato usado no webhook. */
export async function asaasGetPayment(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${asaasBaseUrl()}/v3/payments/${encodeURIComponent(id)}`,
    { headers: headers() },
  )
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Asaas get payment: ${res.status} ${t}`)
  }
  return (await res.json()) as Record<string, unknown>
}
