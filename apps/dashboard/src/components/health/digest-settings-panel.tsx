/**
 * Time-window digest settings panel (feat #2663).
 *
 * In-pass grouping (a burst to one target → one message) is ALWAYS on, so this
 * panel only exposes the optional time-window mode: a switch to enable it and a
 * minutes input for the buffer window. Non-critical findings are held for that
 * window and flushed together; criticals always send immediately. Server-
 * persisted via `/api/v1/health/alert-digest` (per-owner D1); when D1 is absent
 * the switch still edits the env-derived value (save returns 501, surfaced as a
 * toast) — the operator sets `HEALTH_ALERT_DIGEST_MINUTES` instead.
 */

import { toast } from 'sonner'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  useAlertDigestConfig,
  useAlertDigestConfigMutation,
} from '@/lib/hooks/use-alert-digest-config'
import { describeError } from '@/lib/swr/fetch-error'

export function DigestSettingsPanel() {
  const { config, isLoading } = useAlertDigestConfig()
  const { saveDigest } = useAlertDigestConfigMutation()

  const [enabled, setEnabled] = useState(false)
  const [windowMinutes, setWindowMinutes] = useState('30')
  const [saving, setSaving] = useState(false)

  // Hydrate the draft from the server config whenever it (re)loads.
  useEffect(() => {
    if (!config) return
    setEnabled(config.enabled)
    setWindowMinutes(String(config.windowMinutes || 30))
  }, [config])

  const handleSave = async () => {
    const minutes = Number(windowMinutes)
    if (!Number.isFinite(minutes) || minutes < 0) {
      toast.error('Window must be a non-negative number of minutes')
      return
    }
    setSaving(true)
    try {
      await saveDigest({ enabled, windowMinutes: Math.floor(minutes) })
      toast.success('Digest settings saved')
    } catch (err) {
      toast.error('Failed to save digest settings', {
        description: describeError(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Digest batching</Label>
            {config && !config.hasRow && config.envWindowMinutes > 0 && (
              <Badge variant="secondary">Configured via server env</Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            Group a burst of alerts into one message per channel. A time window
            also holds non-critical alerts and sends them together; criticals
            always send immediately.
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={isLoading}
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Window (minutes)
          </Label>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(e.target.value)}
            className="max-w-[8rem]"
          />
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          Save
        </Button>
      </div>
    </div>
  )
}
