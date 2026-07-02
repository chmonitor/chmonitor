import type { Row, RowData } from '@tanstack/react-table'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { formatQuery } from '@/lib/format-readable'

export interface CodeToggleOptions {
  max_truncate?: number
  hide_query_comment?: boolean
}

interface CodeToggleFormatProps<TData extends RowData = RowData> {
  row: Row<TData>
  value: string
  options?: CodeToggleOptions
}

const CODE_TRUNCATE_LENGTH = 50

export const CodeToggleFormat = function CodeToggleFormat<
  TData extends RowData = RowData,
>({
  row,
  value,
  options,
}: CodeToggleFormatProps<TData>): React.ReactNode {
  const truncate_length = options?.max_truncate || CODE_TRUNCATE_LENGTH

  const handleValueChange = (accordionValue: string) => {
    row.toggleExpanded(accordionValue === 'code')
  }

  if (value.length < truncate_length) {
    return <code>{value}</code>
  }

  const code = formatQuery({
    query: value,
    comment_remove: options?.hide_query_comment,
    truncate: truncate_length,
  })

  return (
    <Accordion
      type="single"
      defaultValue={row.getIsExpanded() ? 'code' : undefined}
      collapsible={row.getIsExpanded()}
      onValueChange={handleValueChange}
    >
      <AccordionItem value="code" className="border-0">
        <AccordionTrigger className="py-0 hover:no-underline">
          <code className="line-clamp-2 truncate font-normal break-words">
            {code}
          </code>
        </AccordionTrigger>
        <AccordionContent>
          <code className="font-normal whitespace-pre-wrap text-stone-500">
            {value}
          </code>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
