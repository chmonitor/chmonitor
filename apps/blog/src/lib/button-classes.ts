/**
 * Shared blog button classes — copied from apps/landing/src/lib/button-classes.ts.
 * shadcn/ui geometry: rounded-md, compact heights, subtle shadow-xs.
 * Color stays monochrome — the primary CTA is a solid ink/white button.
 */

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors active:scale-[.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--brand)]/40 disabled:pointer-events-none disabled:opacity-50'

/** Compact size — the one size used across CTAs. */
const size = `${base} h-10 px-4`

/**
 * The one primary CTA — shadcn "default" variant. Solid white on black in
 * dark, solid ink on white in light (`--primary` / `--primary-foreground`).
 */
export const btnPrimary = `${size} bg-primary text-primary-foreground shadow-xs hover:bg-primary/90`

/** shadcn "outline" variant. */
export const btnOutline = `${size} border border-[var(--hairline-strong)] bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground`
