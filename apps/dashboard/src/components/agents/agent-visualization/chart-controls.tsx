import type { ChartType } from './types'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ChartControlsProps {
  columns: string[]
  numericColumns: string[]
  xKey: string
  yKeys: string[]
  sortBy: string | undefined
  sortOrder: 'asc' | 'desc' | undefined
  chartType: ChartType
  rowCount: number
  numberRowIndex: number
  stacked: boolean
  logScale: boolean
  rightAxisKeys: Set<string>
  onXKeyChange: (val: string) => void
  onYKeyChange: (val: string) => void
  onSortChange: (val: string) => void
  onNumberRowIndexChange: (val: number) => void
  onStackedChange: (val: boolean) => void
  onLogScaleChange: (val: boolean) => void
  onRightAxisKeysChange: (val: Set<string>) => void
}

/** Labelled column-picker select used across the control rows. */
function ColumnSelect({
  label,
  value,
  options,
  onValueChange,
  width,
}: {
  label: string
  value: string
  options: string[]
  onValueChange: (val: string) => void
  width: string
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <Select
        value={value}
        onValueChange={(val) => {
          if (val != null) onValueChange(val)
        }}
      >
        <SelectTrigger className={cn('h-7 text-xs', width)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((col) => (
            <SelectItem key={col} value={col} className="text-xs">
              {col}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Pill-style toggle button shared by the Stacked / Log toggles. */
function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 px-2 rounded-md border text-xs transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-input hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}

export function ChartControls({
  columns,
  numericColumns,
  xKey,
  yKeys,
  sortBy,
  sortOrder,
  chartType,
  rowCount,
  numberRowIndex,
  stacked,
  logScale,
  rightAxisKeys,
  onXKeyChange,
  onYKeyChange,
  onSortChange,
  onNumberRowIndexChange,
  onStackedChange,
  onLogScaleChange,
  onRightAxisKeysChange,
}: ChartControlsProps) {
  // Table chart type doesn't need controls
  if (chartType === 'table') return null

  // Radial and bar_list: just x/y axis pickers, no sort/stacked/log
  if (chartType === 'radial' || chartType === 'bar_list') {
    return (
      <div className="flex flex-wrap gap-2 pb-2">
        <ColumnSelect
          label="Label"
          value={xKey}
          options={columns}
          onValueChange={onXKeyChange}
          width="w-[120px]"
        />
        <ColumnSelect
          label="Value"
          value={yKeys[0] ?? ''}
          options={numericColumns.length > 0 ? numericColumns : columns}
          onValueChange={onYKeyChange}
          width="w-[120px]"
        />
      </div>
    )
  }

  // Number chart type: show column and row selectors
  if (chartType === 'number') {
    return (
      <div className="flex flex-wrap gap-2 pb-2">
        <ColumnSelect
          label="Column"
          value={yKeys[0] ?? ''}
          options={columns}
          onValueChange={onYKeyChange}
          width="w-[140px]"
        />

        {rowCount > 1 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground whitespace-nowrap">Row</span>
            <Select
              value={String(numberRowIndex)}
              onValueChange={(v) => onNumberRowIndexChange(Number(v))}
            >
              <SelectTrigger className="h-7 text-xs w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: Math.min(rowCount, 50) }, (_, i) => (
                  <SelectItem key={i} value={String(i)} className="text-xs">
                    {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <ColumnSelect
          label="Label"
          value={xKey}
          options={columns}
          onValueChange={onXKeyChange}
          width="w-[120px]"
        />
      </div>
    )
  }

  const sortValue = sortBy && sortOrder ? `${sortBy}:${sortOrder}` : '__none__'

  return (
    <>
      <div className="flex flex-wrap gap-2 pb-2">
        <ColumnSelect
          label="X axis"
          value={xKey}
          options={columns}
          onValueChange={onXKeyChange}
          width="w-[120px]"
        />

        <ColumnSelect
          label="Y axis"
          value={yKeys[0] ?? ''}
          options={numericColumns.length > 0 ? numericColumns : columns}
          onValueChange={onYKeyChange}
          width="w-[120px]"
        />

        {/* Sort */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground whitespace-nowrap">Sort</span>
          <Select
            value={sortValue}
            onValueChange={(val) => {
              if (val != null) onSortChange(val)
            }}
          >
            <SelectTrigger className="h-7 text-xs w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">
                No sort
              </SelectItem>
              {columns.flatMap((col) => [
                <SelectItem
                  key={`${col}:asc`}
                  value={`${col}:asc`}
                  className="text-xs"
                >
                  {col} asc
                </SelectItem>,
                <SelectItem
                  key={`${col}:desc`}
                  value={`${col}:desc`}
                  className="text-xs"
                >
                  {col} desc
                </SelectItem>,
              ])}
            </SelectContent>
          </Select>
        </div>

        {/* Stacked toggle (bar and area) */}
        {(chartType === 'bar' || chartType === 'area') && yKeys.length > 1 && (
          <ToggleButton
            active={stacked}
            onClick={() => onStackedChange(!stacked)}
          >
            Stacked
          </ToggleButton>
        )}

        {/* Log scale toggle (radial/bar_list handled by the early return above) */}
        {chartType !== 'pie' && (
          <ToggleButton
            active={logScale}
            onClick={() => onLogScaleChange(!logScale)}
          >
            Log
          </ToggleButton>
        )}
      </div>
      {/* Combo chart: axis assignment per Y key */}
      {chartType === 'combo' && numericColumns.length > 1 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {numericColumns
            .filter((col) => col !== xKey)
            .map((col) => {
              const isRight = rightAxisKeys.has(col)
              return (
                <button
                  type="button"
                  key={col}
                  onClick={() => {
                    const next = new Set(rightAxisKeys)
                    if (isRight) next.delete(col)
                    else next.add(col)
                    onRightAxisKeysChange(next)
                  }}
                  className={cn(
                    'h-6 px-2 rounded border text-[11px] transition-colors',
                    isRight
                      ? 'bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-700'
                      : 'bg-muted/50 text-muted-foreground border-input hover:bg-muted'
                  )}
                  title={
                    isRight
                      ? `${col}: right axis (line)`
                      : `${col}: left axis (bar)`
                  }
                >
                  {col} {isRight ? '(R)' : '(L)'}
                </button>
              )
            })}
        </div>
      )}
    </>
  )
}
