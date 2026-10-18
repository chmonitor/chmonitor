import { toast } from 'sonner'

import { useCallback, useState } from 'react'
import { useActions } from '@/lib/swr'

export function useKillQuery(id: string) {
  const { killQuery } = useActions()
  const [isKilling, setIsKilling] = useState(false)

  const handleKill = useCallback(async () => {
    if (!id) return
    setIsKilling(true)
    try {
      const result = await killQuery(id)
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to kill query')
    } finally {
      setIsKilling(false)
    }
  }, [killQuery, id])

  return { isKilling, handleKill }
}
