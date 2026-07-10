/**
 * Shared landing button classes — one size everywhere (Geist medium: 40px).
 * Keep padding/height identical across hero, nav, pricing, and final CTA.
 */

const size =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md h-10 px-4 text-sm font-medium transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

export const btnPrimary = `${size} bg-primary text-primary-foreground hover:bg-primary/90`

export const btnOutline = `${size} border border-input bg-background hover:bg-accent`

export const btnGhost = `${size} text-muted-foreground hover:bg-accent hover:text-accent-foreground`

/** Full-width variant (pricing cards, mobile drawer). */
export const btnPrimaryBlock = `${btnPrimary} w-full`

export const btnOutlineBlock = `${btnOutline} w-full`

/** Featured-tier CTA on landing pricing — brand orange fill. */
export const btnPrimaryBrand = `${size} bg-[var(--brand-orange)] text-[var(--brand-orange-fg)] hover:bg-[var(--brand-orange)]/90`

/** Final CTA on pure-black band (fixed light-on-dark), brand-orange variant. */
export const btnOnDarkBrand = `${size} bg-[var(--brand-orange)] text-[var(--brand-orange-fg)] hover:bg-[var(--brand-orange)]/90`

/** Final CTA on pure-black band (fixed light-on-dark). */
export const btnOnDarkPrimary = `${size} bg-white text-black hover:bg-white/90`

export const btnOnDarkOutline = `${size} border border-white/15 bg-white/5 text-white hover:bg-white/10`
