import { MeshGradient } from '@paper-design/shaders-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Animated hero background — a single React island (Paper Design's MeshGradient).
 *
 * The rest of the landing page is static Astro; this is the ONLY hydrated
 * component, mounted lazily via `client:visible`. Until it hydrates (and if
 * WebGL is unavailable), the static CSS gradient behind it (`.hero::before` in
 * Base.astro) is what shows — so first paint never waits on this.
 *
 * Design intent: a slow, organic, brand-colored wash that sits BEHIND the
 * headline. A CSS mask fades the shader out of the center (see `.hero-shader`
 * in Base.astro) so the copy stays fully legible; colors are theme-aware so it
 * reads on both the dark and light hero.
 */

// Deep, near-black base carrying warm (orange/amber) + cool (violet/blue) brand
// accents and a touch of emerald — glows on the dark hero.
const COLORS_DARK = ['#0b0b0e', '#241a44', '#f97316', '#3b82f6', '#10b981']
// White base with soft brand tints — a barely-there pastel wash on the light hero.
const COLORS_LIGHT = ['#ffffff', '#fff1e2', '#efe7ff', '#e4f0ff', '#eafaf1']

const SPEED = 0.28 // slow, calm drift

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

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    )
  } catch {
    return false
  }
}

export default function HeroShader() {
  const containerRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const dark = useTheme()
  const [webgl, setWebgl] = useState<boolean | null>(null)
  const [onscreen, setOnscreen] = useState(true)

  useEffect(() => {
    setWebgl(hasWebGL())
  }, [])

  // Pause the shader when the hero scrolls out of view — no GPU work offscreen.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setOnscreen(entry.isIntersecting),
      { threshold: 0 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // WebGL missing → render nothing; the CSS fallback gradient stays visible.
  if (webgl === false) return null

  // speed 0 freezes to a static frame (reduced-motion or offscreen).
  const speed = reduced || !onscreen ? 0 : SPEED

  return (
    <div ref={containerRef} className="hero-shader" aria-hidden="true">
      <MeshGradient
        colors={dark ? COLORS_DARK : COLORS_LIGHT}
        speed={speed}
        distortion={0.7}
        swirl={0.35}
        // Cap resolution: 1x DPR floor + a hard pixel budget keep GPU cost low.
        minPixelRatio={1}
        maxPixelCount={1_600_000}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
