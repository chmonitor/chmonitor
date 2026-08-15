'use client'

import { Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react'

import type { ThresholdPresetId } from '@/lib/health/threshold-presets'
import type { ThresholdsMap } from '@/lib/health/thresholds-storage'

import { HEALTH_CHECKS } from './health-checks'
import { ThresholdField } from './threshold-field'
import { useMemo, useState } from 'react'
import { SegmentedControl } from '@/components/settings/segmented-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  applyPresetToDefaults,
  isThresholdOverridden,
  matchPreset,
  THRESHOLD_PRESETS,
} from '@/lib/health/threshold-presets'
import { cn } from '@/lib/utils'

/**
 * Thresholds tab — presets first, forms only where they are needed.
 *
 * The old tab rendered all 16 checks as raw number-input pairs. This one shows a
 * single sensitivity preset that covers every check, and then only the checks
 * the operator has actually tuned away from that baseline; the rest are picked
 * from a dialog. Same storage shape (`ThresholdsMap`, sparse, key present ⇒
 * tuned), so nothing about save/load changes.
 */
export function ThresholdsPanel({
  thresholds,
  setThresholds,
}: {
  thresholds: ThresholdsMap
  setThresholds: (updater: (prev: ThresholdsMap) => ThresholdsMap) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  // Checks opened from the picker this session — they render as cards even
  // before their values differ from the preset baseline.
  const [pinned, setPinned] = useState<string[]>([])

  const tuned = useMemo(
    () =>
      HEALTH_CHECKS.filter(
        (check) =>
          pinned.includes(check.id) ||
          isThresholdOverridden(thresholds[check.id], check.defaults)
      ),
    [thresholds, pinned]
  )

  const untuned = HEALTH_CHECKS.filter((c) => !tuned.includes(c))

  // The preset every *untuned* check follows. Derived from the stored values so
  // it survives a reload — an all-defaults map reads as "balanced".
  const activePreset: ThresholdPresetId | 'custom' = useMemo(() => {
    const votes = new Map<ThresholdPresetId, number>()
    for (const check of HEALTH_CHECKS) {
      const current = thresholds[check.id] ?? check.defaults
      const match = matchPreset(current, check.defaults)
      if (match) votes.set(match, (votes.get(match) ?? 0) + 1)
    }
    let best: ThresholdPresetId | undefined
    let bestCount = 0
    for (const [id, count] of votes) {
      if (count > bestCount) {
        best = id
        bestCount = count
      }
    }
    return bestCount === HEALTH_CHECKS.length && best
      ? best
      : (best ?? 'custom')
  }, [thresholds])

  const applyPreset = (id: ThresholdPresetId) => {
    const factor = THRESHOLD_PRESETS.find((p) => p.id === id)?.factor ?? 1
    setThresholds(() => {
      // Balanced == the built-in defaults, so it clears the map entirely and a
      // fresh install keeps its exact (empty) stored shape.
      if (id === 'balanced') return {}
      const next: ThresholdsMap = {}
      for (const check of HEALTH_CHECKS) {
        next[check.id] = applyPresetToDefaults(check.defaults, factor)
      }
      return next
    })
  }

  const update = (
    id: string,
    kind: 'warning' | 'critical',
    value: number,
    defaults: { warning: number; critical: number }
  ) => {
    setThresholds((prev) => {
      const current = prev[id] ?? defaults
      const next = { ...current, [kind]: value }
      // Clamp by construction so the pair can never reach the invalid
      // warning > critical state the save handler rejects.
      if (kind === 'warning') next.critical = Math.max(next.critical, value)
      else next.warning = Math.min(next.warning, value)
      return { ...prev, [id]: next }
    })
  }

  const reset = (id: string) => {
    setPinned((prev) => prev.filter((p) => p !== id))
    setThresholds((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2.5 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <SlidersHorizontal className="size-4" strokeWidth={1.5} />
            <h2 className="text-sm font-medium text-foreground">Sensitivity</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Sets the warning and critical thresholds for all{' '}
            {HEALTH_CHECKS.length} health checks at once. Tune individual checks
            below.
          </p>
        </div>
        <SegmentedControl
          value={activePreset === 'custom' ? 'balanced' : activePreset}
          onChange={(id) => applyPreset(id as ThresholdPresetId)}
          ariaLabel="Threshold sensitivity"
          options={THRESHOLD_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
          }))}
        />
        <p className="text-xs text-muted-foreground">
          {activePreset === 'custom'
            ? 'Custom — individual checks below differ from any preset.'
            : THRESHOLD_PRESETS.find((p) => p.id === activePreset)?.description}
        </p>
      </section>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <h2 className="text-sm font-medium text-foreground">
                Tuned checks
              </h2>
              <Badge variant="outline" className="text-xs">
                {tuned.length}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Checks with their own thresholds. Everything else follows the
              sensitivity above.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            disabled={untuned.length === 0}
          >
            <Plus className="size-3.5" strokeWidth={1.5} />
            Tune a check
          </Button>
        </div>

        {tuned.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {tuned.map((check) => {
              const current = thresholds[check.id] ?? check.defaults
              const Icon = check.icon
              return (
                <div
                  key={check.id}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                      {Icon ? <Icon strokeWidth={1.5} /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {check.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Default {check.defaults.warning} /{' '}
                        {check.defaults.critical}
                        {check.unit ? ` ${check.unit}` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => reset(check.id)}
                      aria-label={`Reset ${check.title} to default`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <RotateCcw className="size-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <ThresholdField
                      id={`${check.id}-warning`}
                      label="Warning ≥"
                      tone="warning"
                      value={current.warning}
                      onChange={(v) =>
                        update(check.id, 'warning', v, check.defaults)
                      }
                    />
                    <ThresholdField
                      id={`${check.id}-critical`}
                      label="Critical ≥"
                      tone="critical"
                      value={current.critical}
                      onChange={(v) =>
                        update(check.id, 'critical', v, check.defaults)
                      }
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-card/50 p-4">
            <EmptyState
              variant="no-data"
              icon={<SlidersHorizontal className="size-5" strokeWidth={1.5} />}
              title="Every check follows the sensitivity preset"
              description="That is a good place to start. Tune a specific check when your cluster needs a different number for it."
              action={{
                label: 'Tune a check',
                icon: <Plus className="size-3.5" strokeWidth={1.5} />,
                onClick: () => setPickerOpen(true),
              }}
            />
          </div>
        )}
      </div>

      <CheckPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        checks={untuned}
        thresholds={thresholds}
        onPick={(id) => {
          setPinned((prev) => (prev.includes(id) ? prev : [...prev, id]))
          setPickerOpen(false)
        }}
      />
    </div>
  )
}

function CheckPickerDialog({
  open,
  onOpenChange,
  checks,
  thresholds,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  checks: readonly (typeof HEALTH_CHECKS)[number][]
  thresholds: ThresholdsMap
  onPick: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = checks.filter((c) =>
    c.title.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tune a check</DialogTitle>
          <DialogDescription>
            Pick a health check to give it its own warning and critical
            thresholds, independent of the sensitivity preset.
          </DialogDescription>
        </DialogHeader>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search checks…"
          aria-label="Search health checks"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <ScrollArea className="max-h-80">
          <div className="flex flex-col gap-1.5 pr-3">
            {filtered.map((check) => {
              const current = thresholds[check.id] ?? check.defaults
              const Icon = check.icon
              return (
                <button
                  key={check.id}
                  type="button"
                  onClick={() => onPick(check.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border border-transparent p-2 text-left',
                    'transition-colors hover:border-border hover:bg-muted/50',
                    'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                    {Icon ? <Icon strokeWidth={1.5} /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {check.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      Warning ≥ {current.warning} · Critical ≥{' '}
                      {current.critical}
                    </span>
                  </span>
                  <Plus
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No check matches “{query}”.
              </p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="size-3.5" strokeWidth={1.5} />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
