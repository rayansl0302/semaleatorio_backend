import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env, riotRsoConfigured } from '../config.js'
import { type AuthedRequest, requireFirebaseAuth } from '../middleware/firebaseAuth.js'
import { applyRiotLinkToFirestore } from '../riotLinkFirestore.js'
import { riotExchangeAuthorizationCode, riotFetchAccountMe } from '../riotRsoService.js'
import { signRiotOAuthState, verifyRiotOAuthState } from '../riotState.js'

export const riotRsoRouter = Router()

const urlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthedRequest).firebaseUid ?? req.ip ?? 'unknown',
})

riotRsoRouter.get('/url', requireFirebaseAuth, urlLimiter, (req, res) => {
  if (!riotRsoConfigured(env)) {
    res.status(503).json({
      error: 'riot_sso_not_configured',
      message:
        'Define RIOT_RSO_* e FRONTEND_APP_URL no .env do backend (ver .env.example).',
    })
    return
  }

  const ar = req as AuthedRequest
  const state = signRiotOAuthState(ar.firebaseUid, env.RIOT_RSO_STATE_SECRET!)
  const scope = (env.RIOT_RSO_SCOPES ?? 'openid').trim() || 'openid'

  const params = new URLSearchParams({
    client_id: env.RIOT_RSO_CLIENT_ID!,
    redirect_uri: env.RIOT_RSO_REDIRECT_URI!,
    response_type: 'code',
    scope,
    state,
  })

  const authorizeUrl = `https://auth.riotgames.com/authorize?${params.toString()}`
  res.status(200).json({ authorizeUrl })
})

const callbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
})

riotRsoRouter.get('/callback', callbackLimiter, async (req, res) => {
  if (!riotRsoConfigured(env)) {
    res.status(503).send('Riot RSO não configurado no servidor.')
    return
  }

  const q = req.query as Record<string, string | undefined>
  const err = q.error
  const code = q.code
  const state = q.state
  const base = env.FRONTEND_APP_URL!.replace(/\/$/, '')
  const fail = (reason: string) => {
    res.redirect(302, `${base}/app/perfil?riot_error=${encodeURIComponent(reason)}`)
  }

  if (err) {
    fail(String(err))
    return
  }
  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    fail('missing_code_or_state')
    return
  }

  const verified = verifyRiotOAuthState(state, env.RIOT_RSO_STATE_SECRET!)
  if (!verified) {
    fail('invalid_state')
    return
  }

  try {
    const access = await riotExchangeAuthorizationCode(code)
    const acc = await riotFetchAccountMe(access)
    await applyRiotLinkToFirestore({
      uid: verified.uid,
      gameName: acc.gameName,
      tagLine: acc.tagLine,
      puuid: acc.puuid,
    })
    res.redirect(302, `${base}/app/perfil?riot_linked=1`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'link_failed'
    if (msg === 'slug_taken') {
      fail('slug_taken')
      return
    }
    console.error('[riot callback]', msg)
    fail('link_failed')
  }
})
