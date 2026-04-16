import type { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../config.js'

export const recaptchaVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
})

export async function postRecaptchaVerify(req: Request, res: Response): Promise<void> {
  const raw = (req.body as { token?: unknown })?.token
  if (typeof raw !== 'string' || !raw.trim()) {
    res.status(400).json({ error: 'missing_token' })
    return
  }
  const token = raw.trim()
  const secret = env.RECAPTCHA_SECRET_KEY?.trim()
  if (!secret) {
    res.status(503).json({
      error: 'recaptcha_not_configured',
      message: 'Define RECAPTCHA_SECRET_KEY no .env do backend.',
    })
    return
  }

  const params = new URLSearchParams()
  params.set('secret', secret)
  params.set('response', token)
  const ip = req.ip
  if (typeof ip === 'string' && ip.length > 0) {
    params.set('remoteip', ip)
  }

  try {
    const upstream = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = (await upstream.json()) as { success?: boolean }
    if (!data.success) {
      res.status(400).json({
        error: 'recaptcha_failed',
        message: 'reCAPTCHA inválido ou expirado. Marque de novo e tente.',
      })
      return
    }
    res.status(200).json({ ok: true })
  } catch {
    res.status(502).json({ error: 'recaptcha_upstream_error' })
  }
}
