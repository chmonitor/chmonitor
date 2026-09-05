import { type ReactNode, useEffect, useState } from 'react'

interface ClientOnlyProps {
  children: ReactNode
  fallback?: ReactNode
}

/**
 * ClientOnly wrapper that delays rendering until after hydration.
 *
 * Use this for components that generate dynamic IDs (like Radix UI Tabs,
 * Popovers, Dropdowns) to prevent hydration mismatches between SSR and CSR.
 *
 * @example
 * <ClientOnly fallback={<Skeleton />}>
 *   <Tabs defaultValue="tab1">...</Tabs>
 * </ClientOnly>
 */
export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  if (!hasMounted) {
    return fallback
  }

  return children
}
