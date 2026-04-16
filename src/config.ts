import 'dotenv/config'
import { z } from 'zod'

const emptyToUndef = (v: unknown) => (v === '' || v === undefined ? undefined : v)

/** Se FIREBASE_PROJECT_ID não estiver definido (ex.: Railway), tenta ler `project_id` do JSON da conta de serviço. */
function enrichFirebaseProjectIdFromServiceAccount(): void {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return
  try {
    const j = JSON.parse(raw) as { project_id?: string }
    if (j.project_id && typeof j.project_id === 'string' && j.project_id.length > 0) {
      process.env.FIREBASE_PROJECT_ID = j.project_id
    }
  } catch {
    // JSON inválido: o Zod / runtime do Admin falham depois com mensagem própria
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  ALLOWED_ORIGINS: z.string().optional(),
  /**
   * URL pública deste backend (ex. https://api.teudominio.com).
   * Se não definires, usa RAILWAY_PUBLIC_DOMAIN / RENDER_EXTERNAL_URL ou, em último caso,
   * http://127.0.0.1:PORT (→ Asaas sandbox).
   */
  BACKEND_PUBLIC_URL: z.preprocess(emptyToUndef, z.string().url().optional()),

  /**
   * Força sandbox | production independentemente da URL (ex. túnel ngrok a apontar para dev).
   * Se vazio, o modo Asaas deduz-se da URL pública (localhost → sandbox; resto → production).
   */
  ASAAS_ENV: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['sandbox', 'production']).optional(),
  ),

  /**
   * Chave Asaas de **produção** (api.asaas.com). Em modo sandbox usa-se antes
   * `ASAAS_API_KEY_SANDBOX`, se existir; caso contrário cai aqui como fallback.
   */
  ASAAS_API_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  /** Chave do **sandbox** (api-sandbox.asaas.com). Tem prioridade quando o modo resolvido é sandbox. */
  ASAAS_API_KEY_SANDBOX: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  /** Opcional: chave só para produção; se vazio, produção usa `ASAAS_API_KEY`. */
  ASAAS_API_KEY_PRODUCTION: z.preprocess(emptyToUndef, z.string().min(1).optional()),

  ASAAS_WEBHOOK_TOKEN: z.string().min(32, 'Use um token forte (≥32 chars) conforme doc Asaas'),
  ASAAS_WEBHOOK_TOKEN_SANDBOX: z.preprocess(
    emptyToUndef,
    z.string().min(32).optional(),
  ),
  ASAAS_WEBHOOK_TOKEN_PRODUCTION: z.preprocess(
    emptyToUndef,
    z.string().min(32).optional(),
  ),

  /** Mesmo valor que VITE_FIREBASE_PROJECT_ID no front — só isto basta para validar o login no checkout. */
  FIREBASE_PROJECT_ID: z.string().min(1),

  /**
   * Opcional até precisares do webhook Asaas (ou Riot SSO) gravarem no Firestore.
   * Sem isto: checkout funciona; confirmação automática de pagamento no perfil não.
   */
  FIREBASE_SERVICE_ACCOUNT_JSON: z.preprocess(
    emptyToUndef,
    z.string().min(1).optional(),
  ),

  CHECKOUT_SUCCESS_URL: z.string().url().max(255).optional(),

  RIOT_RSO_CLIENT_ID: z.string().optional(),
  RIOT_RSO_CLIENT_SECRET: z.string().optional(),
  RIOT_RSO_REDIRECT_URI: z.string().url().optional(),
  RIOT_RSO_STATE_SECRET: z.string().min(32).optional(),
  FRONTEND_APP_URL: z.string().url().optional(),
  RIOT_RSO_SCOPES: z.string().optional(),

  /** Chave secreta reCAPTCHA v2 (só servidor) — ver https://developers.google.com/recaptcha/docs/verify */
  RECAPTCHA_SECRET_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
})
  .superRefine((d, ctx) => {
    const hasAny =
      Boolean(d.ASAAS_API_KEY) ||
      Boolean(d.ASAAS_API_KEY_SANDBOX) ||
      Boolean(d.ASAAS_API_KEY_PRODUCTION)
    if (!hasAny) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ASAAS_API_KEY'],
        message:
          'Define ASAAS_API_KEY (produção) e/ou ASAAS_API_KEY_SANDBOX (homologação), ou ASAAS_API_KEY_PRODUCTION.',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

export function riotRsoConfigured(envObj: Env): boolean {
  return Boolean(
    envObj.RIOT_RSO_CLIENT_ID &&
      envObj.RIOT_RSO_CLIENT_SECRET &&
      envObj.RIOT_RSO_REDIRECT_URI &&
      envObj.RIOT_RSO_STATE_SECRET &&
      envObj.FRONTEND_APP_URL,
  )
}

function computePublicBaseUrl(data: Env): string {
  if (data.BACKEND_PUBLIC_URL?.trim()) {
    return data.BACKEND_PUBLIC_URL.trim().replace(/\/$/, '')
  }
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
  if (railway) {
    return `https://${railway.replace(/\/$/, '')}`
  }
  const render = process.env.RENDER_EXTERNAL_URL?.trim()
  if (render) {
    return render.replace(/\/$/, '')
  }
  return `http://127.0.0.1:${data.PORT}`
}

function isLocalhostPublicUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    const h = hostname.toLowerCase()
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h.endsWith('.localhost')
    )
  } catch {
    return /\blocalhost\b|127\.0\.0\.1/i.test(url)
  }
}

function resolveAsaasMode(data: Env, publicBaseUrl: string): 'sandbox' | 'production' {
  if (data.ASAAS_ENV) {
    return data.ASAAS_ENV
  }
  return isLocalhostPublicUrl(publicBaseUrl) ? 'sandbox' : 'production'
}

function loadEnv(): {
  env: Env
  asaasPublicBaseUrl: string
  asaasResolvedMode: 'sandbox' | 'production'
} {
  enrichFirebaseProjectIdFromServiceAccount()

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors
    console.error('Variáveis de ambiente inválidas:', msg)
    console.error(
      '[Railway] Variáveis → adiciona pelo menos: ASAAS_WEBHOOK_TOKEN (token do painel Asaas, ≥32 caracteres) e FIREBASE_PROJECT_ID (ou FIREBASE_SERVICE_ACCOUNT_JSON com project_id). Chaves Asaas: ASAAS_API_KEY e/ou ASAAS_API_KEY_SANDBOX.',
    )
    throw new Error('Configuração .env inválida')
  }
  const data = parsed.data
  if (data.NODE_ENV === 'production') {
    const parts =
      data.ALLOWED_ORIGINS?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? []
    if (parts.length === 0) {
      throw new Error(
        'ALLOWED_ORIGINS em produção: indique ao menos uma origem (URLs do frontend, separadas por vírgula)',
      )
    }
  }

  const asaasPublicBaseUrl = computePublicBaseUrl(data)
  const asaasResolvedMode = resolveAsaasMode(data, asaasPublicBaseUrl)

  return { env: data, asaasPublicBaseUrl, asaasResolvedMode }
}

const loaded = loadEnv()

export const env = loaded.env
export const asaasPublicBaseUrl = loaded.asaasPublicBaseUrl
export const asaasResolvedMode = loaded.asaasResolvedMode

export function asaasBaseUrl(): string {
  return asaasResolvedMode === 'sandbox'
    ? 'https://api-sandbox.asaas.com'
    : 'https://api.asaas.com'
}

export function asaasApiKey(): string {
  if (asaasResolvedMode === 'sandbox') {
    const k = env.ASAAS_API_KEY_SANDBOX ?? env.ASAAS_API_KEY
    if (!k) {
      throw new Error(
        'Modo Asaas sandbox: define ASAAS_API_KEY_SANDBOX ou, em alternativa, ASAAS_API_KEY.',
      )
    }
    return k
  }
  const k = env.ASAAS_API_KEY_PRODUCTION ?? env.ASAAS_API_KEY
  if (!k) {
    throw new Error(
      'Modo Asaas production: define ASAAS_API_KEY ou ASAAS_API_KEY_PRODUCTION.',
    )
  }
  return k
}

/** Para logs: qual variável está a ser usada (sem expor o segredo). */
export function asaasApiKeySource(): string {
  if (asaasResolvedMode === 'sandbox') {
    return env.ASAAS_API_KEY_SANDBOX ? 'ASAAS_API_KEY_SANDBOX' : 'ASAAS_API_KEY'
  }
  if (env.ASAAS_API_KEY_PRODUCTION) return 'ASAAS_API_KEY_PRODUCTION'
  return 'ASAAS_API_KEY'
}

export function asaasWebhookVerifyToken(): string {
  if (asaasResolvedMode === 'sandbox') {
    return env.ASAAS_WEBHOOK_TOKEN_SANDBOX ?? env.ASAAS_WEBHOOK_TOKEN
  }
  return env.ASAAS_WEBHOOK_TOKEN_PRODUCTION ?? env.ASAAS_WEBHOOK_TOKEN
}

/**
 * Alinha o valor do painel Asaas / variável Railway com o que chega no HTTP (BOM, aspas
 * acidentais ao colar no Railway, prefixo `Bearer `).
 */
export function normalizeAsaasWebhookSecret(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim()
  if (s.toLowerCase().startsWith('bearer ')) {
    s = s.slice(7).replace(/^\uFEFF/, '').trim()
  }
  if (s.length >= 2) {
    const a = s[0]
    const b = s[s.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      s = s.slice(1, -1).replace(/^\uFEFF/, '').trim()
      if (s.toLowerCase().startsWith('bearer ')) {
        s = s.slice(7).trim()
      }
    }
  }
  return s
}

/**
 * Valores distintos configurados para o webhook. O handler HTTP compara o header
 * `asaas-access-token` (ou `Authorization: Bearer`) com **qualquer** um — evita 401 quando
 * o deploy está em production mas o token do Sandbox está só em `ASAAS_WEBHOOK_TOKEN_SANDBOX`.
 */
export function asaasWebhookVerifyTokenCandidates(): string[] {
  const raw = [
    env.ASAAS_WEBHOOK_TOKEN,
    env.ASAAS_WEBHOOK_TOKEN_SANDBOX,
    env.ASAAS_WEBHOOK_TOKEN_PRODUCTION,
  ].filter((t): t is string => typeof t === 'string' && t.length > 0)
  const normalized = raw
    .map((t) => normalizeAsaasWebhookSecret(t))
    .filter((t) => t.length >= 32)
  return [...new Set(normalized)]
}
