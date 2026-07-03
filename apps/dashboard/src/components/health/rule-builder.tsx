/**
 * Custom alert rule builder (plan 32).
 *
 * No-code builder: pick a whitelisted metric + operator + warning/critical
 * thresholds. There is NO free-form SQL field here — the metric dropdown is
 * the only thing that selects SQL, and it is populated from the server's
 * `METRIC_CATALOG` (never user text). A live read-only preview shows the
 * exact SQL that will run before the user saves anything.
 */

import { toast } from 'sonner'

import type {
  ComparisonOperator,
  MetricKey,
} from '@/lib/health/rule-builder-schema'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { COMPARISON_OPERATORS } from '@/lib/health/rule-builder-schema'
import {
  useCustomAlertRules,
  useCustomAlertRulesMutations,
  useMetricCatalog,
} from '@/lib/hooks/use-custom-alert-rules'
import { cn } from '@/lib/utils'

function RuleRow({
  rule,
  onDeleted,
}: {
  rule: {
    id: string
    name: string
    metric: string
    op: string
    warning: number
    critical: number
  }
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const { deleteRule } = useCustomAlertRulesMutations()

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteRule(rule.id)
      onDeleted()
    } catch {
      toast.error('Failed to delete custom rule')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium">{rule.name}</span>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Badge variant="outline">{rule.metric}</Badge>
          <span>
            warning {rule.op} {rule.warning} · critical {rule.op}{' '}
            {rule.critical}
          </span>
        </div>
      </div>
      <Button variant="ghost" size="sm" disabled={busy} onClick={handleDelete}>
        Delete
      </Button>
    </div>
  )
}

function AddRuleForm({ onCreated }: { onCreated: () => void }) {
  const { catalog } = useMetricCatalog()
  const { createRule, testMetric } = useCustomAlertRulesMutations()

  const [name, setName] = useState('')
  const [metric, setMetric] = useState<MetricKey | ''>('')
  const [op, setOp] = useState<ComparisonOperator>('>=')
  const [warning, setWarning] = useState('')
  const [critical, setCritical] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const selectedEntry = useMemo(
    () => catalog.find((c) => c.key === metric),
    [catalog, metric]
  )

  const handleTest = async () => {
    if (!metric) return
    setTesting(true)
    setTestResult(null)
    try {
      const outcome = await testMetric(metric)
      setTestResult(
        outcome.value === null ? 'No data' : `${outcome.value} ${outcome.unit}`
      )
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async () => {
    const warningNum = Number(warning)
    const criticalNum = Number(critical)
    if (
      !name.trim() ||
      !metric ||
      !Number.isFinite(warningNum) ||
      !Number.isFinite(criticalNum)
    ) {
      toast.error('Fill in a name, metric, and numeric thresholds')
      return
    }
    setBusy(true)
    try {
      await createRule({
        name: name.trim(),
        metric,
        op,
        warning: warningNum,
        critical: criticalNum,
      })
      toast.success('Custom rule saved')
      setName('')
      setMetric('')
      setWarning('')
      setCritical('')
      onCreated()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save custom rule'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <Label className="text-sm font-medium">Add custom rule</Label>

      <Input
        placeholder="Rule name (e.g. Too many stuck merges)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Select value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Select a metric" />
          </SelectTrigger>
          <SelectContent>
            {catalog.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={op}
          onValueChange={(v) => setOp(v as ComparisonOperator)}
        >
          <SelectTrigger className="w-[90px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPARISON_OPERATORS.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Warning</Label>
          <Input
            type="number"
            className="w-[120px]"
            value={warning}
            onChange={(e) => setWarning(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Critical</Label>
          <Input
            type="number"
            className="w-[120px]"
            value={critical}
            onChange={(e) => setCritical(e.target.value)}
          />
        </div>
        {selectedEntry && (
          <span className="self-end pb-2 text-xs text-muted-foreground">
            unit: {selectedEntry.unit}
          </span>
        )}
      </div>

      {selectedEntry && (
        <p className="text-xs text-muted-foreground">
          Alert when <strong>{selectedEntry.label}</strong> is {op} the
          threshold. Evaluated read-only against a fixed, vetted query — there
          is no way to enter custom SQL here.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={handleSubmit}
        >
          Save rule
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!metric || testing}
          onClick={handleTest}
        >
          {testing ? 'Testing…' : 'Test'}
        </Button>
        {testResult && (
          <span className="text-xs text-muted-foreground">
            Current value: {testResult}
          </span>
        )}
      </div>
    </div>
  )
}

export function RuleBuilderPanel({ className }: { className?: string }) {
  const { rules, isLoading, error, refetch } = useCustomAlertRules()

  // The API returns 501 when no D1 binding (CHM_CLOUD_D1) is configured —
  // mirrors WebhookSubscriptionsPanel's explicit "not available" message
  // instead of silently showing a form that would fail on save.
  const notConfigured =
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: number }).status === 501

  if (notConfigured) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Custom alert rules require a configured database backend (cloud
        deployments, or self-hosted with a D1 database configured). Not
        available on this deployment.
      </p>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        Build a rule from a whitelisted metric, an operator, and
        warning/critical thresholds. No free-form SQL — every metric maps to one
        vetted, read-only query. Rules run alongside the built-in checks on
        every sweep.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && rules.length === 0 && (
        <p className="text-sm text-muted-foreground">No custom rules yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} onDeleted={refetch} />
        ))}
      </div>

      <AddRuleForm onCreated={refetch} />
    </div>
  )
}
