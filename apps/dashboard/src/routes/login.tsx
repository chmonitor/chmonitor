import { createFileRoute, redirect } from '@tanstack/react-router'

/** Conventional alias. The human sign-in page is `/sign-in`. */
export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    throw redirect({ to: '/sign-in' })
  },
})
