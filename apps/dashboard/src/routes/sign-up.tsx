import { createFileRoute } from '@tanstack/react-router'

import { AuthPage } from '@/components/clerk/auth-page'

/**
 * Human sign-up entry. Must stay HTML (`text/html`). Agent auth docs live at
 * `/auth.md` and must not be served from this URL.
 */
export const Route = createFileRoute('/sign-up')({
  component: SignUpPage,
  head: () => ({
    meta: [{ title: 'Sign up — chmonitor' }],
  }),
})

function SignUpPage() {
  return <AuthPage mode="sign-up" />
}
