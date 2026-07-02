import { HalftoneCmyk } from '@paper-design/shaders-react'
import { useEffect, useState } from 'react'

/**
 * Demo island — runs the hero image through Paper Design's HalftoneCmyk shader,
 * recoloring the C/M/Y/K plates to the landing brand accents so the static JPEG
 * becomes a live, brand-tuned CMYK print with subtly animated grain.
 *
 * Ink mapping (from Base.astro brand tokens):
 *   C (cyan plate)    -> --blue   #3b82f6
 *   M (magenta plate) -> --violet #8b5cf6
 *   Y (yellow plate)  -> --orange #f97316
 *   K (black plate)   -> near-black #09090b
 *   paper (back)      -> dark #0b0b0e
 */

// A few on-brand CMYK data-bar variants; one is picked at random per load so
// the hero feels alive across visits. All share the calm-left / busy-right
// composition the copy layout depends on.
const SOURCES = [
  '/landing-assets/hero-cmyk.jpg',
  '/landing-assets/hero-cmyk-2.jpg',
  '/landing-assets/hero-cmyk-3.jpg',
]

// The halftone "paper" + ink plates flip with the site theme so the hero reads
// on both a dark and a light card. Inks map to the landing brand accents.
const PALETTE = {
  dark: {
    back: '#0b0b0e',
    c: '#3b82f6',
    m: '#8b5cf6',
    y: '#f97316',
    k: '#09090b',
  },
  light: {
    back: '#eef0f3',
    c: '#2563eb',
    m: '#7c3aed',
    y: '#ea6a0a',
    k: '#0b0b0e',
  },
} as const

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

function useTheme() {
  const [dark, setDark] = useState(true)
  useEffect(() => {
    const root = document.documentElement
    const read = () => setDark(root.getAttribute('data-theme') !== 'light')
    read()
    const obs = new MutationObserver(read)
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export default function HeroHalftone() {
  const reduced = useReducedMotion()
  const dark = useTheme()
  const ink = dark ? PALETTE.dark : PALETTE.light
  // Pick once on mount so the image stays stable through re-renders.
  const [src] = useState(
    () => SOURCES[Math.floor(Math.random() * SOURCES.length)]
  )

  return (
    <HalftoneCmyk
      image={src}
      // Fit the source image to cover the canvas, biased so the busy right
      // side stays visible and the left keeps negative space for copy.
      fit="cover"
      // Slight overfill + no pan: with cover the 16:9 image locks horizontally
      // against the taller card, so any offsetX would sample past the edge and
      // clamp into a visible band. Keep it centered.
      scale={1.35}
      offsetX={0}
      // CMYK inks recolored to brand accents (theme-aware paper + plates).
      colorBack={ink.back}
      colorC={ink.c}
      colorM={ink.m}
      colorY={ink.y}
      colorK={ink.k}
      // Finer cells + higher contrast keep the source image legible (clearer),
      // ink type still softens moiré from the already-dotted source.
      type="ink"
      size={0.24}
      contrast={1.4}
      softness={0}
      // A touch of living grain; frozen for reduced-motion.
      speed={reduced ? 0 : 0.4}
      grainSize={0.4}
      grainMixer={0.15}
      grainOverlay={0.1}
      minPixelRatio={2}
      maxPixelCount={5_000_000}
      style={{ width: '100%', height: '100%' }}
    />
  )
}
