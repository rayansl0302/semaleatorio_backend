/** Igual ao frontend (semaleatorio) — slug para /u/:slug */
export function profileSlugFromNick(nickname: string, tag: string): string {
  const n = nickname
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const t = tag.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9]+/g, '')
  const base = [n || 'invocador', t || 'br1'].join('-')
  return base.replace(/-+/g, '-')
}
