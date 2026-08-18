import { createFileRoute, redirect } from '@tanstack/react-router'

import { keepHostSearch } from './-root-search'

/** Conventional alias. The human sign-in page is `/sign-in`. */
export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    // Root search requires `host`, so a bare `to` does not type-check.
    throw redirect({ to: '/sign-in', search: keepHostSearch })
  },
})
