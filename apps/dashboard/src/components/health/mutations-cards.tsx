import { GitMerge, Wrench } from 'lucide-react'

import type { ComputedMutations } from '@/lib/health/health-status'
import type { HealthCardVariant } from './health-card-shell'
import type { HealthCheckDef, RelatedLink } from './health-checks'

import { HealthCardShell } from './health-card-shell'
import { HealthDetailDialog } from './health-detail-dialog'
import { useState } from 'react'

interface MutationsCardProps {
  hostId: number
  /** Status/value/label resolved upstream in the grid. */
  computed: ComputedMutations
  /** Observed values, oldest first, for the trend sparkline. */
  spark?: number[]
  /** ClickHouse version, forwarded to the detail dialog. */
  clickhouseVersion?: string
  /** Expanded card (issues) or dense row (healthy) — decided by the grid. */
  variant?: HealthCardVariant
}

const MUTATIONS_LINKS: readonly RelatedLink[] = [
  { label: 'Mutations', href: '/mutations' },
  { label: 'Tables Overview', href: '/tables-overview' },
]

const MUTATIONS_DOCS = [
  {
    label: 'system.mutations',
    url: 'https://clickhouse.com/docs/en/operations/system-tables/mutations',
  },
  {
    label: 'ALTER … UPDATE / DELETE',
    url: 'https://clickhouse.com/docs/en/sql-reference/statements/alter/update',
  },
] as const

// Minimal check definitions so the mutations cards reuse the same detail dialog
// (and drill-down breakdown) as the standard checks — they are rendered outside
// HEALTH_CHECKS because their status uses bespoke multi-field rules.
const STUCK_MUTATIONS_DEF: HealthCheckDef = {
  id: 'stuck-mutations',
  title: 'Mutations',
  icon: Wrench,
  chartName: 'summary-stuck-mutations',
  detailChartName: 'health-stuck-mutations-detail',
  detailEmptyMessage: 'No in-progress or failed mutations.',
  valueKey: 'stuck',
  defaults: { warning: 1, critical: 1 },
  description:
    'In-progress and failed data mutations (ALTER … UPDATE / DELETE). Any stuck or failed mutation blocks later mutations on the same table.',
  systemTables: ['system.mutations'],
  commonCauses: [
    'Mutation references a column that no longer exists',
    'A replica is unreachable, so parts cannot be rewritten',
    'Disk full or slow storage stalling the part rewrite',
  ],
  relatedLinks: MUTATIONS_LINKS,
  docsLinks: MUTATIONS_DOCS,
  sql: `SELECT
  countIf(is_done = 0) AS active,
  countIf(is_done = 0 AND isNotNull(latest_fail_time)) AS failed
FROM system.mutations`,
}

const RUNNING_MUTATIONS_DEF: HealthCheckDef = {
  id: 'running-mutations',
  title: 'Running Mutations',
  icon: GitMerge,
  chartName: 'summary-used-by-mutations',
  detailChartName: 'health-running-mutations-detail',
  detailEmptyMessage: 'No mutations are currently running.',
  valueKey: 'running_count',
  defaults: { warning: 3, critical: 10 },
  description:
    'Mutations currently in progress. A large or growing count means mutations are queuing faster than the background pool can apply them.',
  systemTables: ['system.mutations'],
  commonCauses: [
    'Many concurrent ALTER … UPDATE / DELETE statements',
    'Background pool saturated by merges',
    'Large parts making each mutation slow to apply',
  ],
  relatedLinks: MUTATIONS_LINKS,
  docsLinks: MUTATIONS_DOCS,
  sql: `SELECT count() AS running_count
FROM system.mutations
WHERE is_done = 0`,
}

function MutationsCard({
  def,
  hostId,
  computed,
  spark,
  clickhouseVersion,
  variant,
}: MutationsCardProps & { def: HealthCheckDef }) {
  const [detailOpen, setDetailOpen] = useState(false)

  return (
    <>
      <HealthCardShell
        icon={def.icon}
        title={def.title}
        status={computed.status}
        displayValue={computed.value.toLocaleString()}
        sublabel={computed.label}
        spark={spark}
        links={def.relatedLinks}
        hostId={hostId}
        onExpand={() => setDetailOpen(true)}
        variant={variant}
      />

      <HealthDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        check={def}
        hostId={hostId}
        status={computed.status}
        value={computed.value}
        label={computed.label}
        thresholds={def.defaults}
        clickhouseVersion={clickhouseVersion}
      />
    </>
  )
}

export function StuckMutationsCard(props: MutationsCardProps) {
  return <MutationsCard def={STUCK_MUTATIONS_DEF} {...props} />
}

export function RunningMutationsCard(props: MutationsCardProps) {
  return <MutationsCard def={RUNNING_MUTATIONS_DEF} {...props} />
}
