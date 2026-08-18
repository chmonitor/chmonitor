import { createFileRoute } from '@tanstack/react-router'

import { AuthPage } from '@/components/clerk/auth-page'

/**
 * Human sign-in entry. Must stay HTML (`text/html`). Agent auth docs live at
 * `/auth.md` and must not be served from this URL.
 */
export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
  head: () => ({
    meta: [{ title: 'Sign in — chmonitor' }],
  }),
})

function SignInPage() {
  return <AuthPage mode="sign-in" />
}
