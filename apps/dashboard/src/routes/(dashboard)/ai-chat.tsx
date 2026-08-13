import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useEffect } from 'react'
import { PageSkeleton } from '@/components/skeletons'
import { keepHostSearch } from '../-root-search'

/**
 * Redirect page for legacy /ai-chat route.
 * Redirects to the new /agents route.
 */
function AiChatRedirectPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate({ to: '/agents', search: keepHostSearch, replace: true })
  }, [navigate])

  return <PageSkeleton />
}

export const Route = createFileRoute('/(dashboard)/ai-chat')({
  component: AiChatRedirectPage,
})
