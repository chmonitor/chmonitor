/**
 * Shared landing button classes — pill-shaped (fully rounded), one large size
 * everywhere (h-12, px-6). Editorial monochrome: the primary CTA is a solid
 * ink/white pill, secondary is a quiet dark surface with a faint border. Color
 * comes from screenshots and art panels, not from buttons.
 *
 * Pills use `rounded-full`. Cards use `rounded-xl` (12px).
 */

const size =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full h-12 px-6 text-sm font-medium transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--brand)]/40'

/**
 * The one primary CTA — monochrome pill. Solid white on black in dark, solid
 * ink on white in light (`--primary` / `--primary-foreground`).
 */
export const btnPrimary = `${size} bg-primary text-primary-foreground hover:bg-primary/90`

export const btnOutline = `${size} border border-[var(--hairline-strong)] bg-secondary text-foreground hover:bg-accent`

export const btnGhost = `${size} text-muted-foreground hover:bg-accent hover:text-accent-foreground`

/** Larger ink-on-canvas CTA for "Self-host" style secondary actions. */
export const btnDownload = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full h-12 px-6 text-sm font-medium transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--brand)]/40 bg-primary text-primary-foreground hover:bg-primary/90`

/** Full-width variant (pricing cards, mobile drawer). */
export const btnPrimaryBlock = `${btnPrimary} w-full`

export const btnOutlineBlock = `${btnOutline} w-full`

/** Ink-filled CTA — used where the brand fill would be a second voltage. */
export const btnInk = `${size} bg-primary text-primary-foreground hover:bg-primary/90`

export const btnInkBlock = `${btnInk} w-full`

/** Final CTA band (light-on-dark regardless of theme). Monochrome white pill. */
export const btnOnDarkBrand = `${size} bg-white text-black hover:bg-white/90`

export const btnOnDarkPrimary = `${size} bg-white text-black hover:bg-white/90`

export const btnOnDarkOutline = `${size} border border-white/15 bg-white/5 text-white hover:bg-white/10`
