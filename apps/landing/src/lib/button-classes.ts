/**
 * Shared landing button classes — shadcn/ui geometry: rounded-md, compact
 * heights, subtle shadow-xs on filled/outline variants. CTAs use a compact
 * size (h-10, px-4); color stays monochrome — the primary CTA is a solid
 * ink/white button. Color comes from screenshots and art panels, not buttons.
 *
 * Buttons use `rounded-md` (shadcn default). Cards keep `rounded-xl` (12px).
 */

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--brand)]/40 disabled:pointer-events-none disabled:opacity-50'

/** Compact size — the one size used across the landing CTAs. */
const size = `${base} h-10 px-4`

/**
 * The one primary CTA — shadcn "default" variant. Solid white on black in
 * dark, solid ink on white in light (`--primary` / `--primary-foreground`).
 */
export const btnPrimary = `${size} bg-primary text-primary-foreground shadow-xs hover:bg-primary/90`

/** shadcn "outline" variant. */
export const btnOutline = `${size} border border-[var(--hairline-strong)] bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground`

/** Larger ink-on-canvas CTA for "Self-host" style secondary actions. */
export const btnDownload = `${size} bg-primary text-primary-foreground shadow-xs hover:bg-primary/90`

/** Full-width variant (pricing cards, mobile drawer). */
export const btnPrimaryBlock = `${btnPrimary} w-full`

export const btnOutlineBlock = `${btnOutline} w-full`

/** Ink-filled CTA — used where the brand fill would be a second voltage. */
export const btnInk = `${size} bg-primary text-primary-foreground shadow-xs hover:bg-primary/90`

export const btnInkBlock = `${btnInk} w-full`

/** Final CTA band (light-on-dark regardless of theme). Monochrome white. */
export const btnOnDarkBrand = `${size} bg-white text-black shadow-xs hover:bg-white/90`

export const btnOnDarkPrimary = `${size} bg-white text-black shadow-xs hover:bg-white/90`

export const btnOnDarkOutline = `${size} border border-white/15 bg-white/5 text-white hover:bg-white/10`
