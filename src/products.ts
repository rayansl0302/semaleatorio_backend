/** Alinhado com semaleatorio/src/lib/pricing.ts */
export const PRODUCT_REF = {
  premiumEssential: 'SA_PREMIUM_ESSENTIAL_30D',
  premiumComplete: 'SA_PREMIUM_COMPLETE_30D',
  boost1h: 'SA_BOOST_1H',
  boost2h: 'SA_BOOST_2H',
} as const

export type ProductRef = (typeof PRODUCT_REF)[keyof typeof PRODUCT_REF]

const BRL: Record<ProductRef, number> = {
  [PRODUCT_REF.premiumEssential]: 19.9,
  [PRODUCT_REF.premiumComplete]: 29.9,
  [PRODUCT_REF.boost1h]: 3,
  [PRODUCT_REF.boost2h]: 5,
}

const DAYS_PREMIUM = 30
const MS_DAY = 86400000
export const PREMIUM_MS = DAYS_PREMIUM * MS_DAY
export const BOOST_1H_MS = 60 * 60 * 1000
export const BOOST_2H_MS = 2 * 60 * 60 * 1000

export function isProductRef(s: string): s is ProductRef {
  return (Object.values(PRODUCT_REF) as string[]).includes(s)
}

export function brlValue(ref: ProductRef): number {
  return BRL[ref]
}

export function productDescription(ref: ProductRef): string {
  switch (ref) {
    case PRODUCT_REF.premiumEssential:
      return 'SemAleatório — Premium Essencial (30 dias)'
    case PRODUCT_REF.premiumComplete:
      return 'SemAleatório — Premium Pro (30 dias)'
    case PRODUCT_REF.boost1h:
      return 'SemAleatório — Destaque na lista (1 h)'
    case PRODUCT_REF.boost2h:
      return 'SemAleatório — Destaque na lista (2 h)'
    default:
      return 'SemAleatório'
  }
}
