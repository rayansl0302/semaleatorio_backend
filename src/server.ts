import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { env } from './config.js'
import { getFirebaseApp } from './firebaseAdmin.js'
import { checkoutRouter } from './routes/checkout.js'
import { healthRouter } from './routes/health.js'
import { riotRsoRouter } from './routes/riotRso.js'
import { webhookAsaasRouter } from './routes/webhookAsaas.js'

getFirebaseApp()

const app = express()
app.set('trust proxy', 1)

app.use(helmet())

const parsedOrigins =
  env.ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []
const corsOrigin: boolean | string[] =
  parsedOrigins.length > 0 ? parsedOrigins : env.NODE_ENV !== 'production'

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

app.listen(env.PORT, () => {
  console.log(
    `backend-semaleatorio listening on :${env.PORT} (asaas=${env.ASAAS_ENV})`,
  )
})
