'use client'

/**
 * Statistics Insights settings form.
 *
 * Per-user controls for the anomaly overlays drawn on the statistical charts
 * (`/queries/insights`, Cluster Statistics): a moving-average line + ±k·σ band,
 * and an optional absolute threshold line. Persisted by
 * `useStatsInsightsSettings`; changes apply immediately and broadcast to the
 * charts. Mirrors the AI Insights settings form layout.
 */

import { RotateCcw } from 'lucide-react'

import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  BAND_MULTIPLIER_RANGE,
  MA_WINDOW_RANGE,
} from '@/lib/insights/stats-settings'
import { useStatsInsightsSettings } from '@/lib/query/use-stats-insights-settings'
import { cn } from '@/lib/utils'

export function StatsInsightsSettingsForm({
  className,
}: {
  className?: string
}) {
  const { settings, update, reset } = useStatsInsightsSettings()
  const maId = useId()
  const bandId = useId()
  const thresholdId = useId()

  return (
    <Card className={cn(className)}>
      <CardContent className="space-y-5 pt-6">
        {/* Moving average + band */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Moving average band</Label>
              <p className="text-xs text-muted-foreground">
                Overlay a rolling average with a ±k·σ band; points outside the
                band are flagged as anomalies.
              </p>
            </div>
            <Switch
              checked={settings.showMovingAverage}
              onCheckedChange={(v) => update({ showMovingAverage: v })}
              aria-label="Toggle moving-average band"
            />
          </div>

          <div
            className={cn(
              'grid grid-cols-2 gap-3',
              !settings.showMovingAverage && 'pointer-events-none opacity-50'
            )}
          >
            <div className="space-y-1.5">
              <Label htmlFor={maId} className="text-xs text-muted-foreground">
                Window (points)
              </Label>
              <Input
                id={maId}
                type="number"
                inputMode="numeric"
                min={MA_WINDOW_RANGE.min}
                max={MA_WINDOW_RANGE.max}
                value={settings.maWindow}
                disabled={!settings.showMovingAverage}
                onChange={(e) => update({ maWindow: Number(e.target.value) })}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={bandId} className="text-xs text-muted-foreground">
                Band width (×σ)
              </Label>
              <Input
                id={bandId}
                type="number"
                inputMode="decimal"
                step={0.5}
                min={BAND_MULTIPLIER_RANGE.min}
                max={BAND_MULTIPLIER_RANGE.max}
                value={settings.bandMultiplier}
                disabled={!settings.showMovingAverage}
                onChange={(e) =>
                  update({ bandMultiplier: Number(e.target.value) })
                }
                className="h-8"
              />
            </div>
          </div>
        </div>

        {/* Absolute threshold */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Absolute threshold</Label>
              <p className="text-xs text-muted-foreground">
                Draw a fixed horizontal line; points above it are highlighted.
              </p>
            </div>
            <Switch
              checked={settings.showThreshold}
              onCheckedChange={(v) => update({ showThreshold: v })}
              aria-label="Toggle absolute threshold line"
            />
          </div>

          <div
            className={cn(
              'space-y-1.5',
              !settings.showThreshold && 'pointer-events-none opacity-50'
            )}
          >
            <Label
              htmlFor={thresholdId}
              className="text-xs text-muted-foreground"
            >
              Threshold value
            </Label>
            <Input
              id={thresholdId}
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="e.g. 1000"
              value={settings.threshold ?? ''}
              disabled={!settings.showThreshold}
              onChange={(e) =>
                update({
                  threshold:
                    e.target.value === '' ? null : Number(e.target.value),
                })
              }
              className="h-8"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={reset}
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
