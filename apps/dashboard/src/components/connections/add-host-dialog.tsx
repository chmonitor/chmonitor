import { toast } from 'sonner'
import { useLocation, useNavigate } from '@tanstack/react-router'

import type { FetchError } from '@/lib/swr/fetch-error'
import type { HostStorageMode } from '@/lib/types/host-storage'
import type { ConnectionPreset } from './connection-presets'

import { ConnectionForm, type ConnectionFormData } from './connection-form'
import { ConnectionHelpPanel } from './connection-help-panel'
import { addHostDialogChrome, engineForPreset } from './connection-presets'
import { isSampleClusterHost, SAMPLE_CLUSTER_PRESET } from './sample-preset'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { trackEvent } from '@/lib/analytics/analytics'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useBrowserConnections } from '@/lib/hooks/use-browser-connections'
import {
  useUserConnections,
  useUserConnectionsMutations,
} from '@/lib/hooks/use-user-connections'
import { buildUrl, splitHref } from '@/lib/url/url-builder'
import { keepHostSearch } from '@/routes/-root-search'

interface AddHostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Pre-fill the form with the read-only sample ClickHouse preset — e.g. from
   * the first-run "Try with sample ClickHouse" CTA. The parent must pass this
   * explicitly on every open (including `undefined` for a plain "Add host")
   * since this dialog instance is reused/toggled, not remounted per-CTA.
   * Still goes through the normal test/save validation — prefill only.
   */
  initialPreset?: 'sample'
  /**
   * Connection-type tab to open on (e.g. the setup page's "Connect Postgres"
   * CTA). Threaded into the form's preset selector; users can still switch
   * tabs. Defaults to `'self-hosted'`.
   */
  initialEngine?: ConnectionPreset
  /**
   * Show the in-form "Use sample" quick-fill chip. Defaults on for the
   * regular "Add host" entry points; the sample-cluster convert banner opens
   * this dialog specifically to connect a REAL cluster, so it turns this off
   * to avoid re-offering the sample there.
   */
  showSamplePreset?: boolean
}

export function AddHostDialog({
  open,
  onOpenChange,
  initialPreset,
  initialEngine = 'self-hosted',
  showSamplePreset = true,
}: AddHostDialogProps) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()
  const { config } = useFeaturePermissions()
  const { addConnection, connections: browserConnections } =
    useBrowserConnections()
  const { createConnection } = useUserConnectionsMutations()
  const {
    refetch: refetchDb,
    isSignedIn,
    connections: dbConnections,
  } = useUserConnections()
  const [storageMode, setStorageMode] = useState<HostStorageMode>('browser')
  // Active connection-type preset — drives the engine-aware title, description
  // and help panel. Seeded from `initialEngine` and updated as the user
  // switches tabs inside the form (via `onEngineChange`).
  const [engine, setEngine] = useState<ConnectionPreset>(initialEngine)

  // The dialog instance is reused (only `open` toggles), so re-sync the engine
  // to whatever the opener requested each time it opens.
  useEffect(() => {
    if (open) setEngine(initialEngine)
  }, [open, initialEngine])

  const dbStorageConfigured = config.userConnections?.dbStorageEnabled === true
  const dbStorageEnabled = dbStorageConfigured && isSignedIn
  const dbStorageRequiresSignIn = dbStorageConfigured && !isSignedIn
  const allowPostgres = isFeatureEnabled('postgresSource')

  const handleSave = async (data: ConnectionFormData) => {
    // Postgres sources live in their own `?pg=<connectionId>` id space (never
    // the ClickHouse `?host=` ids), so on save we route to the Postgres pages
    // by connection id instead of pushing a `?host=`.
    const isPostgres = data.engine === 'postgres'

    if (storageMode === 'database' && dbStorageEnabled) {
      let result: Awaited<ReturnType<typeof createConnection>>
      try {
        result = await createConnection(data)
      } catch (err) {
        // Cloud signup gate: an account with no subscription (even the $0
        // Free plan counts) is 402'd server-side before its first host.
        const fetchErr = err as FetchError
        if (fetchErr?.details?.reason === 'subscription_required') {
          toast.error(fetchErr.message, {
            action: {
              label: 'Choose a plan',
              onClick: () =>
                navigate({ to: '/billing', search: keepHostSearch }),
            },
          })
          return
        }
        throw err
      }
      await refetchDb()
      if (isPostgres) {
        navigate(
          splitHref(
            `/postgres/queries?pg=${encodeURIComponent(result.data.id)}`
          )
        )
      } else if (result.data.hostId !== undefined) {
        const url = buildUrl(
          pathname,
          { host: result.data.hostId },
          searchParams
        )
        navigate(splitHref(url))
      }
    } else {
      const created = addConnection(data)
      if (isPostgres) {
        navigate(
          splitHref(`/postgres/queries?pg=${encodeURIComponent(created.id)}`)
        )
      } else {
        const url = buildUrl(pathname, { host: created.hostId }, searchParams)
        navigate(splitHref(url))
      }
    }

    // Sample-cluster funnel: distinguish "connected the sample" from
    // "converted from sample to a real cluster" (had the sample already,
    // this new host is not it). Checked against the pre-save connection
    // list, so this fires once per transition.
    if (isSampleClusterHost(data.host)) {
      trackEvent('sample_cluster_connected')
    } else if (
      browserConnections.some((c) => isSampleClusterHost(c.host)) ||
      dbConnections.some((c) => isSampleClusterHost(c.host))
    ) {
      trackEvent('sample_to_real_converted')
    }
    trackEvent('cluster_connect', { storage_mode: storageMode })
    onOpenChange(false)
  }

  const initialValues =
    initialPreset === 'sample' ? SAMPLE_CLUSTER_PRESET : undefined

  const chrome = addHostDialogChrome(engine)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{chrome.title}</DialogTitle>
          <DialogDescription>{chrome.description}</DialogDescription>
        </DialogHeader>

        {/* Two columns on md+ (form left, guidance right); stacks with the form
            on top on narrow screens. */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-4">
            {dbStorageRequiresSignIn && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs">
                <p className="font-medium text-foreground">Sign in to sync</p>
                <p className="mt-0.5 text-muted-foreground">
                  Save connections to the server, pick a plan, or join an
                  organization. Browser-only storage still works without signing
                  in.
                </p>
              </div>
            )}

            <ConnectionForm
              onSave={handleSave}
              onCancel={() => onOpenChange(false)}
              initialValues={initialValues}
              storageMode={storageMode}
              onStorageModeChange={setStorageMode}
              dbStorageEnabled={dbStorageEnabled}
              dbStorageRequiresSignIn={dbStorageRequiresSignIn}
              showSamplePreset={showSamplePreset}
              allowPostgres={allowPostgres}
              allowPeerdb
              initialPreset={initialEngine}
              onEngineChange={setEngine}
            />
          </div>

          <ConnectionHelpPanel engine={engineForPreset(engine)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
