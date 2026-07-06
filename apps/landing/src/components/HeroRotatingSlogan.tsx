import { useEffect, useState } from 'react'
import { HERO_SLOGANS } from '@/lib/hero-slogans'
import { cn } from '@/lib/utils'

const INTERVAL_MS = 4500
const FADE_MS = 280

export function HeroRotatingSlogan() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const [motionOk, setMotionOk] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setMotionOk(!mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!motionOk || HERO_SLOGANS.length < 2) return
    let swap: ReturnType<typeof setTimeout> | undefined
    const tick = setInterval(() => {
      setVisible(false)
      swap = setTimeout(() => {
        setIndex((i) => (i + 1) % HERO_SLOGANS.length)
        setVisible(true)
      }, FADE_MS)
    }, INTERVAL_MS)
    return () => {
      clearInterval(tick)
      if (swap) clearTimeout(swap)
    }
  }, [motionOk])

  return (
    <p
      data-hero-slogan
      aria-live={motionOk ? 'polite' : 'off'}
      className={cn(
        'mx-auto mt-3 min-h-[1.6em] max-w-xl text-pretty font-medium text-lg text-primary tracking-tight transition-opacity duration-300 sm:text-xl',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {HERO_SLOGANS[index]}
    </p>
  )
}
