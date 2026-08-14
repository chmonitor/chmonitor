import { useLocation, useNavigate } from '@tanstack/react-router'

import { useCallback, useMemo } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { splitHref } from '@/lib/url/url-builder'

export function useLayoutView(): [
  'table' | 'cards',
  (newView: 'table' | 'cards') => void,
] {
  const searchParams = useUrlSearchParams()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const layoutParam = searchParams.get('layout')

  const isMobile = useIsMobile()
  const view = useMemo<'table' | 'cards'>(() => {
    if (layoutParam === 'card') return 'cards'
    if (layoutParam === 'table') return 'table'
    return isMobile ? 'cards' : 'table'
  }, [layoutParam, isMobile])

  const setView = useCallback(
    (newView: 'table' | 'cards') => {
      const params = new URLSearchParams(searchParams.toString())
      if (newView === 'cards') {
        params.set('layout', 'card')
      } else {
        params.set('layout', 'table')
      }
      navigate({
        ...splitHref(`${pathname}?${params.toString()}`),
        replace: true,
      })
    },
    [searchParams, navigate, pathname]
  )

  return [view, setView]
}
