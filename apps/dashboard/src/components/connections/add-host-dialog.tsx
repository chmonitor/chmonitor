import type { HostStorageMode } from '@/lib/types/host-storage'

import { ConnectionForm, type ConnectionFormData } from './connection-form'
import { ConnectionHelpPanel } from './connection-help-panel'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { trackEvent } from '@/lib/analytics/analytics'
import { docsSiteUrl } from '@/lib/docs-site'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useBrowserConnections } from '@/lib/hooks/use-browser-connections'
import {
  useUserConnections,
  useUserConnectionsMutations,
} from '@/lib/hooks/use-user-connections'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { buildUrl } from '@/lib/url/url-builder'

interface AddHostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddHostDialog({ open, onOpenChange }: AddHostDialogProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { config } = useFeaturePermissions()
  const { addConnection } = useBrowserConnections()
  const { createConnection } = useUserConnectionsMutations()
  const { refetch: refetchDb, isSignedIn } = useUserConnections()
  const [storageMode, setStorageMode] = useState<HostStorageMode>('browser')

  const dbStorageConfigured = config.userConnections?.dbStorageEnabled === true
  const dbStorageEnabled = dbStorageConfigured && isSignedIn

  const handleSave = async (data: ConnectionFormData) => {
    if (storageMode === 'database' && dbStorageEnabled) {
      const result = await createConnection(data)
      const hostId = result.data.hostId
      await refetchDb()
      if (hostId !== undefined) {
        const url = buildUrl(pathname, { host: hostId }, searchParams)
        router.push(url)
      }
    } else {
      const created = addConnection(data)
      const url = buildUrl(pathname, { host: created.hostId }, searchParams)
      router.push(url)
    }
    trackEvent('cluster_connect', { storage_mode: storageMode })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add ClickHouse host</DialogTitle>
          <DialogDescription>
            Point chmonitor at a ClickHouse cluster to start monitoring. It
            needs a user with <code>SELECT</code> on <code>system.*</code> — see
            the guidance on the right for grants, firewall setup, and how your
            credentials are stored.
          </DialogDescription>
        </DialogHeader>

        {/* Two columns on md+ (form left, guidance right); stacks with the form
            on top on narrow screens. */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-4">
            {!isSignedIn && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300">
                <p className="font-medium">Sign in for more</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                  Server storage is disabled on this deployment.{' '}
                  <a
                    href={docsSiteUrl('features/user-connections')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
                  >
                    Enable user connections
                  </a>
                  . Sign in to select your plan or join an organization to get
                  access to your team&apos;s clusters.
                </p>
              </div>
            )}

            <ConnectionForm
              onSave={handleSave}
              onCancel={() => onOpenChange(false)}
              storageMode={storageMode}
              onStorageModeChange={setStorageMode}
              dbStorageEnabled={dbStorageEnabled}
              dbStorageRequiresSignIn={dbStorageConfigured && !isSignedIn}
            />
          </div>

          <ConnectionHelpPanel />
        </div>
      </DialogContent>
    </Dialog>
  )
}
