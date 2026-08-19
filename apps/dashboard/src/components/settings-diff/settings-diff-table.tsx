import { DownloadIcon } from '@radix-ui/react-icons'

import type {
  SettingsDiffHostInfo,
  SettingsDiffRow,
} from '@/lib/settings-diff/types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function exportSettingsCsv(
  columns: SettingsDiffHostInfo[],
  rows: SettingsDiffRow[]
) {
  const hostHeaders = columns.map((h) => h.name)
  const defaultHeader = columns.length > 0 ? 'Default' : ''
  const header = [
    'Name',
    'Table',
    defaultHeader,
    ...hostHeaders,
    'Has Diff',
    'Changed From Default',
  ]
    .filter(Boolean)
    .join(',')

  const lines = rows.map((row) => {
    const defaultValue =
      columns.length > 0 ? (row.values[columns[0].id]?.defaultValue ?? '') : ''
    const hostValues = columns.map(
      (h) => `"${(row.values[h.id]?.value ?? '').replace(/"/g, '""')}"`
    )
    return [
      `"${row.name}"`,
      row.table,
      `"${defaultValue.replace(/"/g, '""')}"`,
      ...hostValues,
      row.hasDiff ? 'true' : 'false',
      row.changedFromDefault ? 'true' : 'false',
    ].join(',')
  })

  const csv = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'settings-diff.csv'
  a.click()
  URL.revokeObjectURL(url)
}

interface SettingsDiffTableProps {
  columns: SettingsDiffHostInfo[]
  rows: SettingsDiffRow[]
}

export function SettingsDiffTable({ columns, rows }: SettingsDiffTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64 min-w-48">Name</TableHead>
                <TableHead className="w-40">Table</TableHead>
                <TableHead className="w-36 text-muted-foreground">
                  Default
                </TableHead>
                {columns.map((host) => (
                  <TableHead key={host.id} className="w-36">
                    {host.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3 + columns.length}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No settings match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const defaultValue =
                    columns.length > 0
                      ? (row.values[columns[0].id]?.defaultValue ?? '—')
                      : '—'
                  return (
                    <TableRow
                      key={`${row.table}::${row.name}`}
                      className={
                        row.hasDiff
                          ? 'bg-amber-50 dark:bg-amber-950/20'
                          : undefined
                      }
                    >
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-2">
                          {row.name}
                          {row.changedFromDefault && (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400"
                            >
                              modified
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.table === 'merge_tree_settings'
                          ? 'merge_tree'
                          : 'settings'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {defaultValue}
                      </TableCell>
                      {columns.map((host) => {
                        const cell = row.values[host.id]
                        const isDifferent =
                          row.hasDiff &&
                          columns.some(
                            (h) =>
                              h.id !== host.id &&
                              row.values[h.id]?.value !== cell?.value
                          )
                        return (
                          <TableCell
                            key={host.id}
                            className={`font-mono text-xs${isDifferent ? ' font-semibold text-amber-700 dark:text-amber-400' : ''}`}
                          >
                            {cell?.value ?? (
                              <span className="text-muted-foreground/50">
                                n/a
                              </span>
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsCsvButton({
  columns,
  rows,
}: {
  columns: SettingsDiffHostInfo[]
  rows: SettingsDiffRow[]
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => exportSettingsCsv(columns, rows)}
      disabled={rows.length === 0}
    >
      <DownloadIcon className="mr-2 h-3.5 w-3.5" />
      Export CSV
    </Button>
  )
}
