import { FieldValue, getDb } from './firebaseAdmin.js'
import { profileSlugFromNick } from './lib/profileSlug.js'

/**
 * Grava nick/tag/puuid/slug e mantém `profileSlugIndex` coerente (como no AuthContext do app).
 */
export async function applyRiotLinkToFirestore(params: {
  uid: string
  gameName: string
  tagLine: string
  puuid: string
}): Promise<void> {
  const db = getDb()
  const userRef = db.collection('users').doc(params.uid)
  const idxColl = db.collection('profileSlugIndex')

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef)
    if (!userSnap.exists) {
      throw new Error('user_not_found')
    }

    const data = userSnap.data()!
    const prevSlug =
      typeof data.profileSlug === 'string' && data.profileSlug.trim() !== ''
        ? data.profileSlug.trim()
        : profileSlugFromNick(
            String(data.nickname ?? 'Invocador'),
            String(data.tag ?? 'BR1'),
          )

    const nextSlug = profileSlugFromNick(params.gameName, params.tagLine)
    const nextIdxRef = idxColl.doc(nextSlug.toLowerCase())

    if (nextSlug !== prevSlug) {
      const idxSnap = await tx.get(nextIdxRef)
      if (idxSnap.exists) {
        const d = idxSnap.data() as { uid?: string }
        if (d?.uid && d.uid !== params.uid) {
          throw new Error('slug_taken')
        }
      }
    }

    const prevIdxRef = idxColl.doc(prevSlug.toLowerCase())

    tx.set(
      userRef,
      {
        nickname: params.gameName,
        tag: params.tagLine,
        riotPuuid: params.puuid,
        profileSlug: nextSlug,
        lastOnline: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    if (prevSlug !== nextSlug) {
      tx.delete(prevIdxRef)
    }
    tx.set(nextIdxRef, { uid: params.uid })
  })
}
