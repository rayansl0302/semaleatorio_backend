import type { DocumentSnapshot } from 'firebase-admin/firestore'

export type ReferralProgramConfig = {
  enabled: boolean
  /** Percentual da 1ª indicação paga até (tier2MinNth - 1). */
  percentTier1: number
  /** A partir da N-ésima indicação paga (inclusive). */
  percentTier2: number
  percentTier3: number
  tier2MinNth: number
  tier3MinNth: number
  maxRewardsPerReferrerPerMonth: number
}

export const REFERRAL_CONFIG_DEFAULTS: ReferralProgramConfig = {
  enabled: true,
  percentTier1: 5,
  percentTier2: 10,
  percentTier3: 20,
  tier2MinNth: 20,
  tier3MinNth: 50,
  maxRewardsPerReferrerPerMonth: 0,
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function parseReferralConfigSnap(snap: DocumentSnapshot): ReferralProgramConfig {
  if (!snap.exists) return REFERRAL_CONFIG_DEFAULTS
  const d = snap.data() ?? {}
  const t2 = clampInt(d.tier2MinNth, 2, 500, REFERRAL_CONFIG_DEFAULTS.tier2MinNth)
  let t3 = clampInt(d.tier3MinNth, 3, 10_000, REFERRAL_CONFIG_DEFAULTS.tier3MinNth)
  if (t3 <= t2) {
    t3 = t2 + 1
  }
  return {
    enabled: typeof d.enabled === 'boolean' ? d.enabled : REFERRAL_CONFIG_DEFAULTS.enabled,
    percentTier1: clampInt(d.percentTier1, 0, 100, REFERRAL_CONFIG_DEFAULTS.percentTier1),
    percentTier2: clampInt(d.percentTier2, 0, 100, REFERRAL_CONFIG_DEFAULTS.percentTier2),
    percentTier3: clampInt(d.percentTier3, 0, 100, REFERRAL_CONFIG_DEFAULTS.percentTier3),
    tier2MinNth: t2,
    tier3MinNth: t3,
    maxRewardsPerReferrerPerMonth: clampInt(
      d.maxRewardsPerReferrerPerMonth,
      0,
      500,
      REFERRAL_CONFIG_DEFAULTS.maxRewardsPerReferrerPerMonth,
    ),
  }
}

/** `nth` = número desta indicação paga para o indicador (1 = primeira). */
export function referralPercentForNth(nth: number, cfg: ReferralProgramConfig): number {
  if (!Number.isFinite(nth) || nth < 1) return cfg.percentTier1
  if (nth >= cfg.tier3MinNth) return cfg.percentTier3
  if (nth >= cfg.tier2MinNth) return cfg.percentTier2
  return cfg.percentTier1
}
