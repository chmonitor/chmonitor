import { z } from 'zod'

import {
  capResultRows,
  hostIdSchema,
  resolveHostId,
  truncationNote,
  validatedReadOnlyQuery,
} from './helpers'
import { dynamicTool } from 'ai'

export function createVisualizationTools(hostId: number) {
  return {
    query_and_visualize: dynamicTool({
      description:
        'Execute a SQL query and return structured visualization config. Automatically detects chart dimensions and measures from the result columns.',
      inputSchema: z.object({
        sql: z.string().describe('SQL query to execute and visualize'),
        title: z.string().optional().describe('Chart title'),
        chartType: z
          .enum([
            'bar',
            'line',
            'area',
            'pie',
            'number',
            'table',
            'combo',
            'radial',
            'bar_list',
            'scatter',
          ])
          .optional()
          .describe(
            'Suggested chart type. bar=grouped bars, line/area=time-series, pie=proportions, number=single metric, table=raw data, combo=multi-axis, radial=radial bar gauge, bar_list=ranked horizontal bars (top N), scatter=correlation between two numeric columns'
          ),
        xKey: z.string().optional().describe('Column for X axis'),
        yKeys: z
          .array(z.string())
          .optional()
          .describe('Column(s) for Y axis metrics'),
        sortBy: z.string().optional().describe('Column to sort by'),
        sortOrder: z
          .enum(['asc', 'desc'])
          .optional()
          .describe('Sort direction'),
        readable: z
          .enum(['bytes', 'duration', 'number', 'quantity'])
          .optional()
          .describe('Value format hint'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          sql,
          title,
          chartType,
          xKey: inputXKey,
          yKeys: inputYKeys,
          sortBy,
          sortOrder,
          readable,
          hostId: paramHostId,
        } = input as {
          sql: string
          title?: string
          chartType?:
            | 'bar'
            | 'line'
            | 'area'
            | 'pie'
            | 'number'
            | 'table'
            | 'combo'
            | 'radial'
            | 'bar_list'
            | 'scatter'
          xKey?: string
          yKeys?: string[]
          sortBy?: string
          sortOrder?: 'asc' | 'desc'
          readable?: 'bytes' | 'duration' | 'number' | 'quantity'
          hostId?: number
        }

        const effectiveHostId = resolveHostId(paramHostId, hostId)
        const rawRows = (await validatedReadOnlyQuery({
          sql,
          hostId: effectiveHostId,
        })) as Record<string, unknown>[]
        const { data: rows, truncated } = capResultRows(rawRows)

        const columns = rows.length > 0 ? Object.keys(rows[0]) : []
        const firstRow = rows[0] ?? {}

        const resolvedXKey =
          inputXKey ??
          (columns.length > 0
            ? (columns.find((col) => typeof firstRow[col] === 'string') ??
              columns[0])
            : '')

        let resolvedYKeys = inputYKeys ?? []
        if (resolvedYKeys.length === 0) {
          resolvedYKeys = columns.filter(
            (col) => col !== resolvedXKey && typeof firstRow[col] === 'number'
          )
          if (resolvedYKeys.length === 0) {
            resolvedYKeys = columns.filter((col) => col !== resolvedXKey)
          }
        }

        // Auto-pick chart type based on shape of results
        const resolvedChartType = (() => {
          if (chartType) return chartType
          // Single row + single metric → large number display
          if (rows.length === 1 && resolvedYKeys.length === 1) return 'number'
          // Two numeric columns (no string dimension) → scatter for correlation
          const stringColumns = columns.filter(
            (col) => col !== resolvedXKey && typeof firstRow[col] === 'string'
          )
          if (
            resolvedYKeys.length >= 2 &&
            stringColumns.length === 0 &&
            rows.length > 5
          )
            return 'scatter'
          // Many rows with one string label + one numeric → ranked bar list
          if (
            rows.length >= 10 &&
            resolvedYKeys.length === 1 &&
            typeof firstRow[resolvedXKey] === 'string'
          )
            return 'bar_list'
          return 'bar'
        })()

        return {
          type: 'visualization' as const,
          title: title ?? sql.slice(0, 60),
          sql,
          rows,
          rowCount: rows.length,
          columns,
          truncated,
          ...(truncated && { note: truncationNote() }),
          viz: {
            chartType: resolvedChartType,
            xKey: resolvedXKey,
            yKeys: resolvedYKeys,
            ...(sortBy !== undefined ? { sortBy } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            ...(readable !== undefined ? { readable } : {}),
          },
        }
      },
    }),
  }
}
