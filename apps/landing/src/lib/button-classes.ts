/**
 * Shared landing button classes — one size everywhere (40px; 44px for the
 * larger `btnDownload`). Keep padding/height identical across hero, nav,
 * pricing, and final CTA.
 *
 * `rounded-lg` resolves to 8px, the CTA radius. Cards use `rounded-xl` (12px).
 */

const size =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg h-10 px-[18px] text-sm font-medium transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--brand)]/40'

/**
 * The one brand CTA. Fill is `--brand-strong`, not `--brand`: a 14px label is
 * "normal text" to WCAG, and white clears 4.5:1 only against the deeper tone.
 */
export const btnPrimary = `${size} bg-[var(--brand-strong)] text-[var(--on-brand)] hover:bg-[var(--brand-ink)]`

export const btnOutline = `${size} border border-[var(--hairline-strong)] bg-card text-foreground hover:bg-accent`

export const btnGhost = `${size} text-muted-foreground hover:bg-accent hover:text-accent-foreground`

/** Larger ink-on-canvas CTA (44px) for "Self-host" style secondary actions. */
export const btnDownload = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg h-11 px-5 text-sm font-medium transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--brand)]/40 bg-primary text-primary-foreground hover:bg-primary/90`

/** Full-width variant (pricing cards, mobile drawer). */
export const btnPrimaryBlock = `${btnPrimary} w-full`

export const btnOutlineBlock = `${btnOutline} w-full`

/** Ink-filled CTA — used where the brand fill would be a second voltage. */
export const btnInk = `${size} bg-primary text-primary-foreground hover:bg-primary/90`

export const btnInkBlock = `${btnInk} w-full`

/** Final CTA on the fixed ink band (light-on-dark regardless of theme). */
export const btnOnDarkBrand = `${size} bg-[var(--brand-strong)] text-[var(--on-brand)] hover:bg-[var(--brand)]`

export const btnOnDarkPrimary = `${size} bg-white text-black hover:bg-white/90`

export const btnOnDarkOutline = `${size} border border-white/15 bg-white/5 text-white hover:bg-white/10`
