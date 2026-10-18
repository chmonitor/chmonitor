import type { Row, RowData } from '@tanstack/react-table'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { replaceTemplateInReactNode } from '@/lib/template-utils'

export type HoverCardContent = string | React.ReactNode

export type HoverCardOptions = {
  content: HoverCardContent
}

interface HoverCardProps<TData extends RowData = RowData> {
  row: Row<TData>
  value: React.ReactNode
  options?: HoverCardOptions
}

export const HoverCardFormat = function HoverCardFormat<
  TData extends RowData = RowData,
>({ row, value, options }: HoverCardProps<TData>): React.ReactNode {
  const { content } = options || {}

  const rowData = extractRowData(content, row as Row<unknown>)

  const processedContent = replaceTemplateInReactNode(content, rowData)

  // Normalize bigint to string: React 19 ReactNode includes bigint but radix-ui's
  // bundled @types/react does not, causing a type mismatch at the JSX boundary.
  const normalizedValue =
    typeof value === 'bigint' ? value.toString() : (value as React.ReactNode)

  return (
    <HoverCard>
      <HoverCardTrigger aria-label="Show details">
        {normalizedValue}
      </HoverCardTrigger>
      <HoverCardContent role="tooltip">{processedContent}</HoverCardContent>
    </HoverCard>
  )
}

function extractRowData(
  content: string | React.ReactNode | undefined,
  row: Row<unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  const extractKeys = (node: string | React.ReactNode | undefined): void => {
    if (typeof node === 'string') {
      const matches = node.match(/\[(.*?)\]/g)
      if (matches) {
        for (const match of matches) {
          const key = match.slice(1, -1).trim()
          data[key] = row.getValue(key)
        }
      }
    } else if (node && typeof node === 'object') {
      const children = (node as { props?: { children?: React.ReactNode } })
        .props?.children
      if (children) {
        if (Array.isArray(children)) {
          children.forEach(extractKeys)
        } else {
          extractKeys(children)
        }
      }
    }
  }

  extractKeys(content)
  return data
}
