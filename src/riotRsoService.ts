import { env } from './config.js'

type TokenResponse = {
  access_token?: string
  token_type?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type AccountMeResponse = {
  puuid?: string
  gameName?: string
  tagLine?: string
}

/** Troca authorization_code por access_token (client secret só no servidor). */
export async function riotExchangeAuthorizationCode(
  code: string,
): Promise<string> {
  const cid = env.RIOT_RSO_CLIENT_ID!
  const sec = env.RIOT_RSO_CLIENT_SECRET!
  const redirect = env.RIOT_RSO_REDIRECT_URI!

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect,
  })

  const basic = Buffer.from(`${cid}:${sec}`).toString('base64')
  const res = await fetch('https://auth.riotgames.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  })

  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !json.access_token) {
    const msg =
      json.error_description ?? json.error ?? `token HTTP ${res.status}`
    throw new Error(msg)
  }
  return json.access_token
}

export async function riotFetchAccountMe(accessToken: string): Promise<{
  puuid: string
  gameName: string
  tagLine: string
}> {
  const res = await fetch(
    'https://americas.api.riotgames.com/riot/account/v1/accounts/me',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  const json = (await res.json().catch(() => ({}))) as AccountMeResponse
  if (
    !res.ok ||
    typeof json.puuid !== 'string' ||
    typeof json.gameName !== 'string' ||
    typeof json.tagLine !== 'string'
  ) {
    throw new Error(`accounts/me falhou (HTTP ${res.status})`)
  }
  return {
    puuid: json.puuid,
    gameName: json.gameName.trim(),
    tagLine: json.tagLine.trim().replace(/^#/, ''),
  }
}
