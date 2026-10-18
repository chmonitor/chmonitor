import { SignInRequired } from '@/components/auth/sign-in-required'

/** Shown when the PeerDB API answers 401: PeerDB is set up, the visitor is signed out. */
export function PeerDBSignInRequired() {
  return (
    <SignInRequired
      title="Sign in to view PeerDB"
      description="Mirrors and peers are shown to signed-in users. Sign in to continue."
      testId="peerdb-sign-in-required"
    />
  )
}
