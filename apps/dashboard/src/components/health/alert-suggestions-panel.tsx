/**
 * Suggested alerts panel (issue #2667).
 *
 * Renders the server-computed smart alert suggestions as cards: a reason, the
 * proposed thresholds (editable inline), and Accept / Dismiss. Accepting posts
 * the (possibly edited) thresholds through the same custom-rules path the rule
 * builder uses, so a one-click accept lands a working custom rule. There is no
 * free-form SQL surface — every suggestion targets a whitelisted metric.
 */

import { Lightbulb } from 'lucide-react'
import { toast } from 'sonner'

import type {
  AlertSuggestionInfo,
  SuggestionSource,
} from '@/lib/hooks/use-alert-suggestions'

import { useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useAlertSuggestionMutations,
  useAlertSuggestions,
} from '@/lib/hooks/use-alert-suggestions'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

const SOURCE_LABELS: Record<SuggestionSource, string> = {
  'recurring-finding': 'Recurring',
  baseline: 'Baseline',
  'near-threshold': 'Near threshold',
  'cluster-shape': 'Cluster shape',
}

function SuggestionCard({
  suggestion,
  onChanged,
}: {
  suggestion: AlertSuggestionInfo
  onChanged: () => void
}) {
  const { acceptSuggestion, dismissSuggestion } = useAlertSuggestionMutations()
  const [warning, setWarning] = useState(String(suggestion.warning))
  const [critical, setCritical] = useState(String(suggestion.critical))
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null)

  const handleAccept = async () => {
    const warningNum = Number(warning)
    const criticalNum = Number(critical)
    if (!Number.isFinite(warningNum) || !Number.isFinite(criticalNum)) {
      toast.error('Thresholds must be numbers')
      return
    }
    setBusy('accept')
    try {
      await acceptSuggestion({
        name: suggestion.title,
        metric: suggestion.metric,
        op: suggestion.op,
        warning: warningNum,
        critical: criticalNum,
      })
      toast.success('Rule created from suggestion')
      onChanged()
    } catch (err) {
      toast.error('Failed to accept suggestion', {
        description: describeError(err),
      })
    } finally {
      setBusy(null)
    }
  }

  const handleDismiss = async () => {
    setBusy('dismiss')
    try {
      await dismissSuggestion(suggestion.key)
      onChanged()
    } catch (err) {
      toast.error('Failed to dismiss suggestion', {
        description: describeError(err),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium">
            {suggestion.title}
          </span>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Badge variant="secondary">
              {SOURCE_LABELS[suggestion.source]}
            </Badge>
            <Badge variant="outline">{suggestion.metric}</Badge>
            <span>{suggestion.hostName}</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{suggestion.reason}</p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Warning {suggestion.op}
          </Label>
          <Input
            type="number"
            inputMode="decimal"
            className="w-[120px]"
            value={warning}
            onChange={(e) => setWarning(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Critical {suggestion.op}
          </Label>
          <Input
            type="number"
            inputMode="decimal"
            className="w-[120px]"
            value={critical}
            onChange={(e) => setCritical(e.target.value)}
          />
        </div>
        <span className="self-end pb-2 text-xs text-muted-foreground">
          {suggestion.unit}
          {suggestion.currentValue !== null
            ? ` · now ${suggestion.currentValue}`
            : ''}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy !== null} onClick={handleAccept}>
          {busy === 'accept' ? 'Accepting…' : 'Accept'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={handleDismiss}
        >
          {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
        </Button>
      </div>
    </div>
  )
}

export function AlertSuggestionsPanel({ className }: { className?: string }) {
  const { suggestions, isLoading, error, refetch } = useAlertSuggestions()

  // 501 when no D1 binding — mirror RuleBuilderPanel's "not available" note.
  const notConfigured =
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: number }).status === 501

  if (notConfigured) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Alert suggestions require a configured database backend (cloud
        deployments, or self-hosted with a D1 database configured). Not
        available on this deployment.
      </p>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        Smart suggestions from this cluster's live behaviour — near-threshold
        metrics, learned baselines, cluster shape, and recurring findings. Each
        maps to a vetted, read-only metric; accepting one creates a custom rule
        evaluated on every sweep.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && suggestions.length === 0 && (
        <EmptyState
          icon={
            <Lightbulb
              className="size-6 text-muted-foreground"
              strokeWidth={1.5}
            />
          }
          title="No suggestions right now"
          description="This cluster looks well-covered. New suggestions appear as behaviour changes or findings recur."
        />
      )}

      <div className="flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.key}
            suggestion={suggestion}
            onChanged={() => refetch()}
          />
        ))}
      </div>
    </div>
  )
}
