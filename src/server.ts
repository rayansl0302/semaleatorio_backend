import { asaasApiKeySource, asaasPublicBaseUrl, asaasResolvedMode, env } from './config.js'
import { hasFirebaseAdminCredentials } from './firebaseAdmin.js'
import { app } from './app.js'

app.listen(env.PORT, () => {
  const fs = hasFirebaseAdminCredentials()
    ? 'Firestore (webhook/Riot): sim'
    : 'Firestore (webhook/Riot): não — só FIREBASE_PROJECT_ID (checkout ok)'
  console.log(
    `backend-semaleatorio listening on :${env.PORT} | Asaas=${asaasResolvedMode} (URL base: ${asaasPublicBaseUrl}) | chave API: ${asaasApiKeySource()} | ${fs}`,
  )
})
