import type { ReactNode } from 'react'
import type {
  SettingsDiffHostInfo,
  SettingsDiffRow,
} from '@/lib/settings-diff/types'

import { useMemo } from 'react'
import { DataTable } from '@/components/data-table/data-table'
import {
  buildSettingsDiffQueryConfig,
  toSettingsDiffTableRows,
  uniqueHostColumnKeys,
} from '@/lib/settings-diff/table-rows'

const EMPTY_TABLE_CONTEXT: Record<string, string> = {}

interface SettingsDiffTableProps {
  columns: SettingsDiffHostInfo[]
  rows: SettingsDiffRow[]
  toolbarExtras?: ReactNode
}

export function SettingsDiffTable({
  columns,
  rows,
  toolbarExtras,
}: SettingsDiffTableProps) {
  const showMatchColumn = columns.length > 1
  const hostColumns = useMemo(() => uniqueHostColumnKeys(columns), [columns])
  const data = useMemo(
    () => toSettingsDiffTableRows(rows, hostColumns, showMatchColumn),
    [rows, hostColumns, showMatchColumn]
  )
  const queryConfig = useMemo(
    () => buildSettingsDiffQueryConfig(hostColumns, showMatchColumn),
    [hostColumns, showMatchColumn]
  )

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-testid="settings-diff-table"
    >
      <DataTable
        title="Settings"
        data={data}
        queryConfig={queryConfig}
        context={EMPTY_TABLE_CONTEXT}
        defaultPageSize={100}
        showSQL={false}
        embedded
        toolbarExtras={toolbarExtras}
        enableColumnReordering
        columnOrderStorageKey="settings-diff"
        enableColumnFilters
        filterableColumns={queryConfig.columns.filter((col) => col !== 'match')}
      />
    </div>
  )
}
