/**
 * PeerDB mirror rules panel (#3699).
 *
 * List / create / edit / enable / mute per-mirror PeerDB alert thresholds.
 * Persisted through `/api/v1/health/peerdb-rules` (the shared health DB, like
 * maintenance windows and quiet hours), so writes are gated by the same
 * store-availability notice. Rules from `alerts.yaml` show a source badge and
 * stay read-only here.
 */

import { toast } from 'sonner'

import type {
  PeerDBRuleInfo,
  PeerDBRuleInput,
} from '@/lib/hooks/use-peerdb-rules'
import type {
  PeerDBRuleCheck,
  PeerDBRuleMatchKind,
  PeerDBRuleSeverity,
} from '@/lib/peerdb/alert-rules'

import { canWriteHealthStore, HealthStoreNotice } from './health-store-notice'
import { useState } from 'react'
import {
  DeclarativeSourceBadge,
  isDeclarativeSource,
} from '@/components/health/declarative-source-badge'
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
import { Switch } from '@/components/ui/switch'
import { useHealthStoreAvailability } from '@/lib/health/store-availability'
import {
  usePeerDBRules,
  usePeerDBRulesMutations,
} from '@/lib/hooks/use-peerdb-rules'
import {
  PEERDB_RULE_CHECK_FIELDS,
  PEERDB_RULE_CHECKS,
  PEERDB_RULE_MATCH_KINDS,
} from '@/lib/peerdb/alert-rules'
import { DEFAULT_PEERDB_ALERT_THRESHOLDS } from '@/lib/peerdb/alerting-thresholds'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

const MUTE_OPTIONS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
] as const

const MATCH_KIND_LABEL: Record<PeerDBRuleMatchKind, string> = {
  exact: 'Exact name',
  prefix: 'Prefix',
  glob: 'Glob (* ?)',
}

function defaultsFor(check: PeerDBRuleCheck): {
  warning: number
  critical: number
} {
  const f = PEERDB_RULE_CHECK_FIELDS[check]
  const warning = DEFAULT_PEERDB_ALERT_THRESHOLDS[f.warn]
  const critical = DEFAULT_PEERDB_ALERT_THRESHOLDS[f.crit]
  // A warn-only default (`throughput-zero`) has no finite critical; offer
  // 4x the warning so the form starts from a value the API accepts.
  return {
    warning,
    critical: Number.isFinite(critical) ? critical : warning * 4,
  }
}

function toInput(rule: PeerDBRuleInfo): PeerDBRuleInput {
  const { source: _source, ...rest } = rule
  return rest
}

function isMuted(rule: PeerDBRuleInfo): boolean {
  return rule.muteUntil !== null && Date.now() < rule.muteUntil
}

function RuleRow({
  rule,
  canWrite,
  onEdit,
}: {
  rule: PeerDBRuleInfo
  canWrite: boolean
  onEdit: (rule: PeerDBRuleInfo) => void
}) {
  const { saveRule, deleteRule } = usePeerDBRulesMutations()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const fields = PEERDB_RULE_CHECK_FIELDS[rule.check]
  const muted = isMuted(rule)

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast.error(failure, { description: describeError(err) })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const update = (patch: Partial<PeerDBRuleInput>) =>
    run(
      () => saveRule({ ...toInput(rule), ...patch }),
      'Failed to update PeerDB rule'
    )

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{fields.label}</span>
          <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">
            {rule.match}
          </code>
          <span className="text-xs text-muted-foreground">
            {MATCH_KIND_LABEL[rule.matchKind]}
          </span>
          {!rule.enabled && <Badge variant="secondary">Disabled</Badge>}
          {rule.severity === 'warning' && (
            <Badge variant="outline">Warning only</Badge>
          )}
          {muted && rule.muteUntil !== null && (
            <Badge variant="outline">
              Muted until {new Date(rule.muteUntil).toLocaleString()}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          Warn at {rule.warning}
          {rule.severity === 'critical'
            ? ` · critical at ${rule.critical}`
            : ''}{' '}
          {fields.unit}
        </span>
      </div>

      {isDeclarativeSource(rule.source) ? (
        <DeclarativeSourceBadge source={rule.source} />
      ) : confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 text-xs text-destructive">Delete?</span>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={busy || !canWrite}
            onClick={() =>
              run(() => deleteRule(rule.id), 'Failed to delete PeerDB rule')
            }
          >
            Yes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            No
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Switch
            size="sm"
            aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
            checked={rule.enabled}
            disabled={busy || !canWrite}
            onCheckedChange={(checked) => update({ enabled: checked })}
          />
          {muted ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !canWrite}
              onClick={() => update({ muteUntil: null })}
            >
              Unmute
            </Button>
          ) : (
            <Select
              value=""
              onValueChange={(value) => {
                if (value) update({ muteUntil: Date.now() + Number(value) })
              }}
              disabled={busy || !canWrite}
            >
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue placeholder="Mute" />
              </SelectTrigger>
              <SelectContent>
                {MUTE_OPTIONS.map((o) => (
                  <SelectItem key={o.ms} value={String(o.ms)}>
                    Mute {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !canWrite}
            onClick={() => onEdit(rule)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !canWrite}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  )
}

function RuleForm({
  initial,
  canWrite,
  onDone,
}: {
  initial: PeerDBRuleInfo | null
  canWrite: boolean
  onDone: () => void
}) {
  const { saveRule } = usePeerDBRulesMutations()
  const [check, setCheck] = useState<PeerDBRuleCheck>(initial?.check ?? 'lag')
  const [matchKind, setMatchKind] = useState<PeerDBRuleMatchKind>(
    initial?.matchKind ?? 'glob'
  )
  const [match, setMatch] = useState(initial?.match ?? '')
  const [warning, setWarning] = useState(
    String(initial?.warning ?? defaultsFor('lag').warning)
  )
  const [critical, setCritical] = useState(
    String(initial?.critical ?? defaultsFor('lag').critical)
  )
  const [severity, setSeverity] = useState<PeerDBRuleSeverity>(
    initial?.severity ?? 'critical'
  )
  const [busy, setBusy] = useState(false)

  const changeCheck = (next: PeerDBRuleCheck) => {
    setCheck(next)
    if (!initial) {
      const d = defaultsFor(next)
      setWarning(String(d.warning))
      setCritical(String(d.critical))
    }
  }

  const handleSubmit = async () => {
    const warn = Number(warning)
    const crit = Number(critical)
    if (!match.trim()) {
      toast.error('Enter a mirror name or pattern')
      return
    }
    if (!Number.isFinite(warn) || !Number.isFinite(crit) || warn < 0) {
      toast.error('Thresholds must be non-negative numbers')
      return
    }
    if (warn > crit) {
      toast.error('Warning must be less than or equal to critical')
      return
    }
    setBusy(true)
    try {
      await saveRule({
        id: initial?.id,
        check,
        matchKind,
        match: match.trim(),
        warning: warn,
        critical: crit,
        severity,
        enabled: initial?.enabled ?? true,
        muteUntil: initial?.muteUntil ?? null,
      })
      toast.success(initial ? 'PeerDB rule updated' : 'PeerDB rule created')
      if (!initial) setMatch('')
      onDone()
    } catch (err) {
      toast.error('Failed to save PeerDB rule', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const unit = PEERDB_RULE_CHECK_FIELDS[check].unit

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label className="text-sm font-medium">
        {initial ? 'Edit rule' : 'Add rule'}
      </Label>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Check</Label>
          <Select
            value={check}
            onValueChange={(v) => v && changeCheck(v as PeerDBRuleCheck)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PEERDB_RULE_CHECKS.map((c) => (
                <SelectItem key={c} value={c}>
                  {PEERDB_RULE_CHECK_FIELDS[c].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Match</Label>
          <Select
            value={matchKind}
            onValueChange={(v) => v && setMatchKind(v as PeerDBRuleMatchKind)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PEERDB_RULE_MATCH_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {MATCH_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Mirror</Label>
          <Input
            placeholder="qrep_sg_fleetreporting1_*"
            value={match}
            onChange={(e) => setMatch(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Warning ({unit})
          </Label>
          <Input
            type="number"
            min={0}
            value={warning}
            onChange={(e) => setWarning(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Critical ({unit})
          </Label>
          <Input
            type="number"
            min={0}
            value={critical}
            disabled={severity === 'warning'}
            onChange={(e) => setCritical(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Severity</Label>
          <Select
            value={severity}
            onValueChange={(v) => v && setSeverity(v as PeerDBRuleSeverity)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="critical">Warning and critical</SelectItem>
              <SelectItem value="warning">Warning only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !canWrite} onClick={handleSubmit}>
          {initial ? 'Save' : 'Add'}
        </Button>
        {initial && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

export function PeerDBRulesPanel({ className }: { className?: string }) {
  const { rules, isLoading, error } = usePeerDBRules()
  const availability = useHealthStoreAvailability({ probeError: error })
  const canWrite = canWriteHealthStore(availability)
  const [editing, setEditing] = useState<PeerDBRuleInfo | null>(null)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        A rule replaces one check&apos;s thresholds for the mirrors it matches.
        When several rules match, the most specific wins: exact name, then the
        longest prefix, then the glob with the most literal characters. A muted
        mirror is still checked and recorded, but no alert is sent.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && rules.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No PeerDB rules. Every mirror uses the default thresholds.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            canWrite={canWrite}
            onEdit={setEditing}
          />
        ))}
      </div>

      <HealthStoreNotice availability={availability} feature="PeerDB rules" />
      <RuleForm
        key={editing?.id ?? 'new'}
        initial={editing}
        canWrite={canWrite}
        onDone={() => setEditing(null)}
      />
    </div>
  )
}
