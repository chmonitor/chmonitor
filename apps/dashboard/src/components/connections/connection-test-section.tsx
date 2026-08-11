import { Check, Loader2 } from 'lucide-react'

import type { TestStatus } from './connection-form-schema'

import { ConnectionErrorPanel } from './connection-error-panel'
import { Button } from '@/components/ui/button'

/**
 * "Test Connection" button + success message + the classified error panel.
 * Extracted verbatim from `ConnectionForm`; behavior is unchanged.
 */
export function ConnectionTestSection({
  testStatus,
  onTest,
  disabled,
  cloudPreset,
}: {
  testStatus: TestStatus
  onTest: () => void
  disabled: boolean
  cloudPreset: boolean
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTest}
          disabled={disabled || testStatus.state === 'loading'}
        >
          {testStatus.state === 'loading' ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : null}
          Test Connection
        </Button>

        {testStatus.state === 'success' && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" />
            {testStatus.message}
          </span>
        )}
      </div>

      {/* Rich, actionable error panel — classifies the raw ClickHouse / network
          error into a cause + fix + docs link for the specific failure kind. */}
      {testStatus.state === 'error' && (
        <ConnectionErrorPanel
          message={testStatus.message}
          cloudPreset={cloudPreset}
        />
      )}
    </>
  )
}
