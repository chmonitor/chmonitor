import { useEffect, useState } from 'react'

interface UseErrorCountdownOptions {
  onCountdownComplete?: () => void
  initialSeconds?: number
}

export function useErrorCountdown({
  onCountdownComplete,
  initialSeconds = 30,
}: UseErrorCountdownOptions = {}) {
  const [countdown, setCountdown] = useState(initialSeconds)

  useEffect(() => {
    if (!onCountdownComplete) return

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          onCountdownComplete()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [onCountdownComplete])

  const resetCountdown = () => setCountdown(initialSeconds)

  return { countdown, resetCountdown }
}
