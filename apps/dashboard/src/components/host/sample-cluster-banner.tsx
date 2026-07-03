import { ArrowRight, X } from 'lucide-react'

import {
  dismissSampleClusterBanner,
  isSampleClusterBannerDismissed,
} from './sample-cluster-banner-dismissed'
import { useEffect, useState } from 'react'
import { AddHostDialog, isSampleClusterHost } from '@/components/connections'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

/**
 * Persistent, dismissible "Connect your own cluster" convert nudge.
 *
 * Shown right below the host switcher once the sample ClickHouse preset
 * (`sample-preset.ts`) is connected and no real (non-sample) host has been
 * added yet. Dismissing it is remembered per-browser
 * (`sample-cluster-banner-dismissed.ts`); connecting a real cluster also
 * retires it for good (no non-sample host left to convert from).
 *
 * Collapsed (icon-only) sidebar has no room for a text banner, so this
 * renders nothing in that state — same gating `HostSwitcher` uses.
 */
export function SampleClusterBanner() {
  const { hosts, isLoading } = useMergedHosts()
  const { isMobile, state } = useSidebar()
  const [dismissed, setDismissed] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  // Read the dismissal flag only after mount (localStorage is unavailable
  // during SSR/prerender) — mirrors useBrowserConnections' `mounted` guard.
  useEffect(() => {
    setDismissed(isSampleClusterBannerDismissed())
    setMounted(true)
  }, [])

  const showExpanded = isMobile || state === 'expanded'
  const hasSampleHost = hosts.some((h) => isSampleClusterHost(h.host))
  const hasConvertedToReal = hosts.some((h) => !isSampleClusterHost(h.host))

  if (
    !mounted ||
    isLoading ||
    dismissed ||
    !hasSampleHost ||
    hasConvertedToReal ||
    !showExpanded
  ) {
    return null
  }

  const handleDismiss = () => {
    dismissSampleClusterBanner()
    setDismissed(true)
  }

  return (
    <>
      <div
        className="relative rounded-lg border bg-muted/40 p-3 text-xs"
        data-testid="sample-cluster-banner"
      >
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
        <p className="pr-4 font-medium">You're exploring the sample</p>
        <p className="mt-0.5 text-muted-foreground">
          Connect your own ClickHouse cluster for real monitoring.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 w-full text-xs"
          onClick={() => setAddOpen(true)}
          data-testid="sample-banner-connect-real"
        >
          Connect your cluster
          <ArrowRight className="size-3.5" />
        </Button>
      </div>
      <AddHostDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        showSamplePreset={false}
      />
    </>
  )
}
