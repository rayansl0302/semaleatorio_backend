import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  ALLOWED_ORIGINS: z.string().optional(),
  ASAAS_ENV: z.enum(['sandbox', 'production']),
  ASAAS_API_KEY: z.string().min(1),
  ASAAS_WEBHOOK_TOKEN: z.string().min(32, 'Use um token forte (≥32 chars) conforme doc Asaas'),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  CHECKOUT_SUCCESS_URL: z.string().url().max(255).optional(),

  /** Riot Sign-On (RSO): opcional até ativares no portal de desenvolvedores. */
  RIOT_RSO_CLIENT_ID: z.string().optional(),
  RIOT_RSO_CLIENT_SECRET: z.string().optional(),
  /** URL registada na Riot que aponta para este backend, ex.: https://api.teudominio.com/api/auth/riot/callback */
  RIOT_RSO_REDIRECT_URI: z.string().url().optional(),
  /** Segredo para assinar o parâmetro `state` (≥32 caracteres aleatórios). */
  RIOT_RSO_STATE_SECRET: z.string().min(32).optional(),
  /** Para onde redirecionar o browser após vincular (ex.: https://semaleatorio.gg/app/perfil). */
  FRONTEND_APP_URL: z.string().url().optional(),
  RIOT_RSO_SCOPES: z.string().optional(),
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

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors
    console.error('Variáveis de ambiente inválidas:', msg)
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
  return data
}

export const env = loadEnv()

export function asaasBaseUrl(): string {
  return env.ASAAS_ENV === 'sandbox'
    ? 'https://api-sandbox.asaas.com'
    : 'https://api.asaas.com'
}
