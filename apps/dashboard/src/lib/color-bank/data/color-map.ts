/**
 * Color map data for color bank.
 *
 * Ultra-pastel/cute color palette with very high lightness and very soft saturation.
 * Each color has shades 200, 250, 300, ..., 700 (11 shades total).
 *
 * Shade descriptions:
 * - 200: lightest (~90-95% lightness, extremely pastel)
 * - 700: darkest (~70-80% lightness, still very soft)
 */

import type { ColorMap, HSLColor } from '../types'

const createShades = (
  h: number,
  s200: number,
  sStep: number,
  l200: number,
  lStep: number
): Record<number, HSLColor> => ({
  200: { h, s: s200, l: l200 },
  250: { h, s: s200 + sStep * 1, l: l200 - lStep * 1 },
  300: { h, s: s200 + sStep * 2, l: l200 - lStep * 2 },
  350: { h, s: s200 + sStep * 3, l: l200 - lStep * 3 },
  400: { h, s: s200 + sStep * 4, l: l200 - lStep * 4 },
  450: { h, s: s200 + sStep * 5, l: l200 - lStep * 5 },
  500: { h, s: s200 + sStep * 6, l: l200 - lStep * 6 },
  550: { h, s: s200 + sStep * 6, l: l200 - lStep * 7 },
  600: { h, s: s200 + sStep * 7, l: l200 - lStep * 8 },
  650: { h, s: s200 + sStep * 7, l: l200 - lStep * 9 },
  700: { h, s: s200 + sStep * 8, l: l200 - lStep * 10 },
})

export const COLOR_MAP: Readonly<ColorMap> = {
  // Mint green - fresh and airy
  mint: createShades(156, 35, 1, 94, 3),
  // Baby blue - dreamy sky blue
  blue: createShades(205, 40, 2, 93, 3),
  // Seafoam - gentle aqua green
  seafoam: createShades(168, 38, 2, 93, 3),
  // Periwinkle - soft blue-purple dream
  periwinkle: createShades(235, 38, 2, 93, 3),
  // Coral - soft pink-orange cotton candy
  coral: createShades(10, 45, 2, 93, 3),
  // Lavender - soft purple field
  lavender: createShades(260, 35, 1, 93, 3),
  // Peach - soft sunset glow
  peach: createShades(25, 42, 2, 93, 3),
  // Lemon - soft sunshine
  lemon: createShades(50, 45, 2, 95, 3),
  // Lilac - soft purple blossom
  lilac: createShades(275, 32, 2, 93, 3),
  // Rose - soft petal pink
  rose: createShades(345, 40, 2, 93, 3),
  // Turquoise - tropical waters
  turquoise: createShades(180, 35, 1, 93, 3),
  // Sky - cotton candy clouds
  sky: createShades(195, 38, 2, 94, 3),
} as const

/**
 * Color bank - base color names available for assignment.
 * Colors are automatically assigned to columns based on name hash.
 */
export const COLOR_BANK: ReadonlyArray<
  | 'mint'
  | 'blue'
  | 'seafoam'
  | 'periwinkle'
  | 'coral'
  | 'lavender'
  | 'peach'
  | 'lemon'
  | 'lilac'
  | 'rose'
  | 'turquoise'
  | 'sky'
> = [
  'mint',
  'blue',
  'seafoam',
  'periwinkle',
  'coral',
  'lavender',
  'peach',
  'lemon',
  'lilac',
  'rose',
  'turquoise',
  'sky',
] as const
