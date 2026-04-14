import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { env } from './config.js'
import { checkoutRouter } from './routes/checkout.js'
import { healthRouter } from './routes/health.js'
import { riotRsoRouter } from './routes/riotRso.js'
import { webhookAsaasRouter } from './routes/webhookAsaas.js'

const app = express()
app.set('trust proxy', 1)

app.use(helmet())

const parsedOrigins =
  env.ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []

const VITE_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

const corsAllowedOrigins =
  env.NODE_ENV !== 'production'
    ? [...new Set([...parsedOrigins, ...VITE_DEV_ORIGINS])]
    : parsedOrigins

const corsOrigin: boolean | string[] =
  corsAllowedOrigins.length > 0 ? corsAllowedOrigins : env.NODE_ENV !== 'production'

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    maxAge: 86400,
  }),
)

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use(globalLimiter)

app.use(express.json({ limit: '256kb' }))

app.use(healthRouter)

app.use('/webhooks/asaas', webhookAsaasRouter)

app.use('/api/auth/riot', riotRsoRouter)

app.use('/api', checkoutRouter)

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

export { app }
