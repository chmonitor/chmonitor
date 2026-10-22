/**
 * Access matrix (#4123): users (or roles) x databases, with the effective
 * access per cell. Click a database header to expand it into its tables,
 * a cell for the privileges behind it, a name for the user or role.
 *
 * Read only. THIS NODE ONLY: grants are read from the selected host, so
 * drift between replicas (users.xml rollouts) is not detected yet.
 */

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'

import type { AccessInputs, GranteeAccess } from '@/lib/security/access-matrix'
import type {
  MatrixFilters,
  MatrixRow,
} from '@/lib/security/access-matrix-view'
import type { CellSelection } from './access-sheets'
import type { Section } from './use-access-data'

import { AccessChip, AccessLegend } from './access-chip'
import { CellSheet, GranteeSheet } from './access-sheets'
import { useAccessData, useDatabaseTables } from './use-access-data'
import { useMemo, useState } from 'react'
import { ChartError } from '@/components/charts/chart-error'
import { Skeleton } from '@/components/skeletons'
import { EmptyState } from '@/components/ui/empty-state'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ACCESS_TABLES_LIMIT } from '@/lib/query-config/security/access-matrix'
import { computeCell } from '@/lib/security/access-matrix'
import {
  buildRows,
  filterRows,
  SYSTEM_DATABASES,
} from '@/lib/security/access-matrix-view'

const ANY_DATABASE = '__any__'

/** A section that failed: named, so the reader knows what is missing. */
function SectionNotice({
  label,
  section,
}: {
  label: string
  section: Section<unknown>
}) {
  if (section.error)
    return (
      <li>
        <span className="font-medium">{label}</span> not available:{' '}
        {section.error.message}. Access shown without it may be incomplete.
      </li>
    )
  if (section.truncated)
    return (
      <li>
        <span className="font-medium">{label}</span> hit the row limit, so some
        cells may show less access than granted.
      </li>
    )
  return null
}

/** The table list of an expanded database stops at the SQL LIMIT. */
export function TablesCapNotice({
  database,
  count,
}: {
  database: string
  count: number
}) {
  if (count < ACCESS_TABLES_LIMIT) return null
  return (
    <p className="text-xs text-muted-foreground">
      Only the first {ACCESS_TABLES_LIMIT} tables of {database} (by name) are
      shown; access to the rest is in the database column.
    </p>
  )
}

function MatrixSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-9 w-full rounded-lg" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full rounded-md" />
      ))}
    </div>
  )
}

export function AccessMatrixView() {
  const data = useAccessData()
  const [kind, setKind] = useState<'user' | 'role'>('user')
  const [filters, setFilters] = useState<MatrixFilters>({
    search: '',
    database: '',
    writeOnly: false,
    hideConfigUsers: false,
  })
  const [showSystemDatabases, setShowSystemDatabases] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [cellSelection, setCellSelection] = useState<CellSelection | null>(null)
  const [granteeSelection, setGranteeSelection] =
    useState<GranteeAccess | null>(null)
  const expandedTables = useDatabaseTables(expanded)

  const inputs: AccessInputs = useMemo(
    () => ({
      grants: data.grants.data,
      roleGrants: data.roleGrants.data,
      profiles: data.profiles.data,
      profileElements: data.profileElements.data,
    }),
    [
      data.grants.data,
      data.roleGrants.data,
      data.profiles.data,
      data.profileElements.data,
    ]
  )

  const databases = useMemo(
    () =>
      data.databases.data
        .map((d) => d.name)
        .filter((d) => showSystemDatabases || !SYSTEM_DATABASES.has(d)),
    [data.databases.data, showSystemDatabases]
  )

  const grantees = kind === 'user' ? data.users.data : data.roles.data
  const rows = useMemo(
    () => buildRows(kind, grantees, databases, inputs),
    [kind, grantees, databases, inputs]
  )
  const visible = useMemo(() => filterRows(rows, filters), [rows, filters])

  const granteeSection = kind === 'user' ? data.users : data.roles
  if (data.grants.isLoading || granteeSection.isLoading)
    return <MatrixSkeleton />
  if (data.grants.error)
    return (
      <ChartError
        error={data.grants.error}
        title="Grants (system.grants)"
        onRetry={() => data.grants.refresh()}
      />
    )

  const notices = [
    ['Grants', data.grants],
    ['Users (SHOW USERS)', data.users],
    ['Roles (SHOW ROLES)', data.roles],
    ['Role grants', data.roleGrants],
    ['Settings profiles (SHOW SETTINGS PROFILES)', data.profiles],
    ['Profile settings', data.profileElements],
    ['Databases', data.databases],
  ] as const

  const columnsFor = (database: string) =>
    expanded === database ? expandedTables.tables : []

  return (
    <div className="flex flex-col gap-4">
      {notices.some(([, s]) => s.error || s.truncated) && (
        <ul className="list-disc space-y-1 rounded-xl border bg-card px-8 py-3 text-xs text-muted-foreground shadow-sm">
          {notices.map(([label, section]) => (
            <SectionNotice key={label} label={label} section={section} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Tabs
          value={kind}
          onValueChange={(v) => setKind(v === 'role' ? 'role' : 'user')}
        >
          <TabsList>
            <TabsTrigger value="user">Users</TabsTrigger>
            <TabsTrigger value="role">Roles</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          aria-label={`Search ${kind}s`}
          placeholder={`Search ${kind}s`}
          className="h-8 w-48 text-[13px]"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <Select
          value={filters.database || ANY_DATABASE}
          items={{
            [ANY_DATABASE]: 'Any database',
            ...Object.fromEntries(databases.map((d) => [d, d])),
          }}
          onValueChange={(v) =>
            setFilters({
              ...filters,
              database: v && v !== ANY_DATABASE ? v : '',
            })
          }
        >
          <SelectTrigger
            className="h-8 w-48 text-[13px]"
            aria-label="Only with access to database"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_DATABASE}>Any database</SelectItem>
            {databases.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="flex items-center gap-2 text-[13px]">
          <Switch
            checked={filters.writeOnly}
            onCheckedChange={(v) => setFilters({ ...filters, writeOnly: v })}
          />
          Write access only
        </Label>
        {kind === 'user' && (
          <Label className="flex items-center gap-2 text-[13px]">
            <Switch
              checked={filters.hideConfigUsers}
              onCheckedChange={(v) =>
                setFilters({ ...filters, hideConfigUsers: v })
              }
            />
            Hide users.xml users
          </Label>
        )}
        <Label className="flex items-center gap-2 text-[13px]">
          <Switch
            checked={showSystemDatabases}
            onCheckedChange={setShowSystemDatabases}
          />
          System databases
        </Label>
      </div>

      <AccessLegend />

      {visible.length === 0 ? (
        <EmptyState
          title={`No ${kind}s match`}
          description={
            rows.length === 0
              ? `No ${kind}s are visible to the monitoring user.`
              : 'Clear a filter to see more.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">
                  {kind === 'user' ? 'User' : 'Role'}
                </th>
                {databases.map((d) => (
                  <th
                    key={d}
                    colSpan={1 + columnsFor(d).length}
                    className="whitespace-nowrap px-3 py-2 font-medium"
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono hover:text-foreground"
                      aria-expanded={expanded === d}
                      onClick={() => setExpanded(expanded === d ? null : d)}
                    >
                      {expanded === d ? (
                        <ChevronDownIcon
                          className="size-3.5"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <ChevronRightIcon
                          className="size-3.5"
                          strokeWidth={1.5}
                        />
                      )}
                      {d}
                    </button>
                  </th>
                ))}
              </tr>
              {expanded && (
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-card px-3 py-1" />
                  {databases.map((d) =>
                    d === expanded ? (
                      [
                        <th
                          key={`${d}:*`}
                          className="px-3 py-1 font-mono font-normal"
                        >
                          *
                        </th>,
                        ...columnsFor(d).map((t) => (
                          <th
                            key={`${d}:${t}`}
                            className="whitespace-nowrap px-3 py-1 font-mono font-normal"
                          >
                            {t}
                          </th>
                        )),
                      ]
                    ) : (
                      <th key={d} />
                    )
                  )}
                </tr>
              )}
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.access.grantee.name}
                  className="border-b border-border/60 last:border-0"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal"
                  >
                    <button
                      type="button"
                      className="font-mono hover:underline"
                      onClick={() => setGranteeSelection(row.access)}
                    >
                      {row.access.grantee.name}
                    </button>
                  </th>
                  {databases.flatMap((d) => [
                    <td key={d} className="px-3 py-1.5">
                      <CellButton
                        row={row}
                        database={d}
                        onOpen={setCellSelection}
                      />
                    </td>,
                    ...columnsFor(d).map((t) => (
                      <td key={`${d}:${t}`} className="px-3 py-1.5">
                        <CellButton
                          row={row}
                          database={d}
                          table={t}
                          onOpen={setCellSelection}
                        />
                      </td>
                    )),
                  ])}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {expanded && (
        <TablesCapNotice
          database={expanded}
          count={expandedTables.tables.length}
        />
      )}
      {expanded && expandedTables.error && (
        <p className="text-xs text-muted-foreground">
          Tables of {expanded} not available: {expandedTables.error.message}
        </p>
      )}

      <CellSheet
        selection={cellSelection}
        onClose={() => setCellSelection(null)}
      />
      <GranteeSheet
        access={granteeSelection}
        data={data}
        onClose={() => setGranteeSelection(null)}
      />
    </div>
  )
}

function CellButton({
  row,
  database,
  table,
  onOpen,
}: {
  row: MatrixRow
  database: string
  table?: string
  onOpen: (selection: CellSelection) => void
}) {
  const cell = table
    ? computeCell(row.access.sourced, { database, table }, row.access.readonly)
    : row.cells.get(database)
  if (!cell) return null
  return (
    <button
      type="button"
      className="rounded-md px-1 py-0.5 hover:bg-muted pointer-coarse:min-h-11"
      aria-label={`${row.access.grantee.name} on ${database}.${table ?? '*'}: ${cell.level}`}
      onClick={() =>
        onOpen({ access: row.access, scope: { database, table }, cell })
      }
    >
      <AccessChip cell={cell} />
    </button>
  )
}
