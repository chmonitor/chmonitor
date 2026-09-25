'use client'

/**
 * "Configure alert" for one health check, opened from the detail dialog (#3437).
 *
 * The point of this form is that the operator never has to re-derive anything:
 * it arrives pre-filled with the check id, the value the dialog is already
 * showing, and the *effective* thresholds (`overrides[check.id] ?? defaults`, which
 * the dialog already receives as `thresholds`). Two things can then be saved, and
 * they are genuinely different things — conflating them is the confusion #3438
 * is fixing:
 *
 * - **Thresholds** (browser) → `health-thresholds` in localStorage, keyed by
 *   `check.id`. Always writable: no database, no account, no network. The
 *   browser dispatcher evaluates them and fires through the local channels.
 * - **A named alert** (server) → a `custom_alert_rules` row, so the cron sweep
 *   evaluates it and the server channels can deliver it. Needs the D1-backed
 *   store, so it is gated on {@link AlertRuleStoreAvailability} and never
 *   silently fails: on a deployment without the store the control is disabled
 *   with the reason shown, exactly as `RuleBuilderPanel` already does.
 */

import { toast } from 'sonner'

import type { MetricAlertSignals } from '@/lib/health/alert-capability'
import type { HealthCheckDef } from './health-checks'
import type { AlertRuleStoreAvailability } from './use-alert-signals'

import { ThresholdField } from './threshold-field'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  resetThreshold,
  setThreshold,
  type Thresholds,
} from '@/lib/health/thresholds-storage'
import { useCustomAlertRulesMutations } from '@/lib/hooks/use-custom-alert-rules'
import { describeError } from '@/lib/swr/fetch-error'

/** Shown wherever a D1-backed alert store is absent — same wording as
 *  `rule-builder.tsx`, so the two surfaces do not describe the same limit two
 *  different ways. */
export const ALERT_STORE_UNAVAILABLE_HINT =
  'Named alerts need a database backend (cloud, or self-hosted with D1 configured). Not available on this deployment — thresholds below still work.'

export function ConfigureAlertForm({
  check,
  value,
  thresholds,
  signals,
  availability,
}: {
  check: HealthCheckDef
  /** Current observed value, shown read-only next to the thresholds it informs. */
  value: number | null
  /** Effective thresholds for this check (override or default). */
  thresholds: Thresholds
  signals: MetricAlertSignals
  availability: AlertRuleStoreAvailability
}) {
  const [warning, setWarning] = useState(thresholds.warning)
  const [critical, setCritical] = useState(thresholds.critical)
  const [name, setName] = useState(check.title)
  const [busy, setBusy] = useState(false)
  const { createRule } = useCustomAlertRulesMutations()

  const isTuned = signals.sources.includes('threshold')
  const catalogMetric = signals.catalogMetric

  const handleSaveThresholds = () => {
    if (warning > critical) {
      toast.error('Warning must be less than or equal to critical')
      return
    }
    // `setThreshold` dispatches `health-thresholds-changed`, which is what
    // re-reads the map behind the badge and the card's own status.
    if (setThreshold(check.id, { warning, critical })) {
      toast.success(`Thresholds saved for ${check.title}`)
    } else {
      toast.error(
        'Failed to save thresholds. Check browser storage permissions.'
      )
    }
  }

  const handleReset = () => {
    if (resetThreshold(check.id)) {
      setWarning(check.defaults.warning)
      setCritical(check.defaults.critical)
      toast.success(`Thresholds reset to the defaults for ${check.title}`)
    } else {
      toast.error('Failed to reset thresholds.')
    }
  }

  const handleCreateRule = async () => {
    if (catalogMetric === null || !name.trim()) return
    if (warning > critical) {
      toast.error('Warning must be less than or equal to critical')
      return
    }
    setBusy(true)
    try {
      await createRule({
        name: name.trim(),
        metric: catalogMetric,
        op: '>=',
        warning,
        critical,
      })
      toast.success(`Named alert "${name.trim()}" created`)
    } catch (err) {
      toast.error('Failed to create the named alert', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Configure alert</span>
          <Badge variant="outline" className="font-mono text-[11px]">
            {check.id}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Pre-filled from this check — current value{' '}
          <span className="font-medium tabular-nums">
            {value === null ? '—' : value.toLocaleString()}
          </span>
          {check.unit ? ` ${check.unit}` : ''} with the thresholds in effect
          right now.
        </p>
      </div>

      {/* --- Thresholds: localStorage, works on every deployment ---------- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Alert thresholds</span>
          {isTuned && (
            <Badge
              variant="secondary"
              className="text-[10px] uppercase tracking-wide"
            >
              Tuned
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          <ThresholdField
            id={`alert-warning-${check.id}`}
            label="Warning ≥"
            value={warning}
            onChange={setWarning}
            tone="warning"
          />
          <ThresholdField
            id={`alert-critical-${check.id}`}
            label="Critical ≥"
            value={critical}
            onChange={setCritical}
            tone="critical"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Saved in this browser. The browser dispatcher fires on them through
          your local channels — no database required.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleSaveThresholds}>
            Save thresholds
          </Button>
          {isTuned && (
            <Button size="sm" variant="ghost" onClick={handleReset}>
              Reset to default
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* --- Named alert: D1-backed, gated on what the write path can do -- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">Named alert</span>
          {signals.sources.includes('rule') && (
            <Badge
              variant="secondary"
              className="text-[10px] uppercase tracking-wide"
            >
              Exists
            </Badge>
          )}
        </div>

        {catalogMetric === null ? (
          <p className="text-[11px] text-muted-foreground">
            This check has no equivalent in the alert-rule metric catalog, so it
            cannot be saved as a named alert. The thresholds above still drive
            it in this browser.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor={`alert-name-${check.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Alert name
              </Label>
              <Input
                id={`alert-name-${check.id}`}
                value={name}
                disabled={availability !== 'available'}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Replication lag too high"
                className="h-8 text-[13px]"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saved on the server so the cron sweep evaluates it and the server
              channels can deliver it, on{' '}
              <span className="font-mono">{catalogMetric}</span>.
            </p>

            {availability === 'unavailable' && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {ALERT_STORE_UNAVAILABLE_HINT}
              </p>
            )}
            {availability === 'unknown' && (
              <p className="text-[11px] text-muted-foreground">
                Checking whether this deployment can store named alerts…
              </p>
            )}

            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  availability !== 'available' ||
                  !name.trim() ||
                  warning > critical
                }
                onClick={() => void handleCreateRule()}
              >
                {busy ? 'Saving…' : 'Save as named alert'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
