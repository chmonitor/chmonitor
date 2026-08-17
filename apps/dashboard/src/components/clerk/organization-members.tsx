import { Building2 } from 'lucide-react'

import {
  OrganizationProfile,
  useOrganization,
} from '@clerk/tanstack-react-start'
import { CloudOnlyNotice } from '@/components/cloud-only-notice'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'

/**
 * Member management surface. Renders Clerk's <OrganizationProfile/> (members,
 * roles, invitations) when the user has an active organization.
 *
 * Clerk imports are static but inert until this renders — and it only renders on
 * the cloud build (the route is cloud-gated in the sidebar), matching the
 * lazy-Clerk pattern used across the app.
 */
export function OrganizationMembers() {
  if (!isClerkEnabled() || !isCloudModeClient()) {
    // OSS / non-cloud: the sidebar already hides this route; this guards direct
    // URL access. Shown as a clean "cloud feature" notice rather than the old
    // misleading "No organization yet" card (which implied the user could —
    // and should — create one).
    return <CloudOnlyNotice feature="Organizations" />
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <OrgProfileGate />
    </div>
  )
}

function OrgProfileGate() {
  const { organization, isLoaded } = useOrganization()

  if (!isLoaded) {
    return <div className="bg-muted h-96 animate-pulse rounded-xl" />
  }

  if (!organization) {
    return <NoOrgState />
  }

  return <OrganizationProfile routing="hash" />
}

function NoOrgState() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex size-12 items-center justify-center rounded-xl">
            <Building2 className="text-primary size-6" />
          </div>
          <CardTitle>No organization yet</CardTitle>
          <CardDescription>
            Create a team in Clerk to invite members and share hosts. There is
            no in-app plan checkout — licenses are sold on chmonitor.dev.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
