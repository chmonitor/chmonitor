import type { HostStorageMode } from '@/lib/types/host-storage'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { docsSiteUrl } from '@/lib/docs-site'

/**
 * "Save to server (synced)" switch + explanatory copy, shown only when the
 * parent passes `onStorageModeChange`. Extracted verbatim from
 * `ConnectionForm`; behavior is unchanged.
 */
export function ConnectionStoragePreference({
  storageMode,
  onStorageModeChange,
  dbStorageEnabled,
  dbStorageRequiresSignIn,
}: {
  storageMode: HostStorageMode
  onStorageModeChange: (mode: HostStorageMode) => void
  dbStorageEnabled: boolean
  dbStorageRequiresSignIn: boolean
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="save-to-server" className="text-sm font-medium">
            Save to server (synced)
          </Label>
          <p className="text-xs text-muted-foreground">
            {storageMode === 'database'
              ? 'Stored encrypted on the server. Syncs across devices when signed in.'
              : 'Stored encrypted in this browser only.'}
          </p>
        </div>
        <Switch
          id="save-to-server"
          checked={storageMode === 'database'}
          disabled={!dbStorageEnabled}
          onCheckedChange={(checked) =>
            onStorageModeChange(checked ? 'database' : 'browser')
          }
        />
      </div>
      {!dbStorageEnabled && (
        <p className="text-xs text-muted-foreground">
          {dbStorageRequiresSignIn ? (
            'Sign in to save connections to the server (synced per account) — then select a plan or join an organization for more access.'
          ) : (
            <>
              Server storage is disabled on this deployment.{' '}
              <a
                href={docsSiteUrl('features/user-connections')}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Enable user connections
              </a>{' '}
              to save credentials to your account and access your team&apos;s
              clusters.
            </>
          )}
        </p>
      )}
    </div>
  )
}
