import { Database, Server, Table as TableIcon } from 'lucide-react'

import { useExplorerState } from './hooks/use-explorer-state'
import { CopyButton } from '@/components/mcp/copy-button'
import { AppLink as Link } from '@/components/ui/app-link'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'

interface ExplorerBreadcrumbProps {
  hostName?: string
}

// Cap so long database/table names ellipsize instead of stretching the
// breadcrumb bar. This is CSS-only truncation (overflow-hidden +
// text-overflow: ellipsis via `truncate`), never a JS substring — the full
// name stays in the DOM, so double-click-select + Cmd+C (or the copy button
// below) always copies the complete name, not the visually clipped part.
const NAME_MAX_WIDTH = 'max-w-[8rem] sm:max-w-[14rem]'

export function ExplorerBreadcrumb({ hostName }: ExplorerBreadcrumbProps) {
  const { hostId, database, table } = useExplorerState()

  return (
    <Breadcrumb data-role="explorer-breadcrumb">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link
              href={`/explorer?host=${hostId}`}
              className="flex items-center gap-1.5"
            >
              <Server className="size-3.5" />
              {hostName || `Host ${hostId}`}
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {database && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="group min-w-0">
              {table ? (
                <BreadcrumbLink asChild>
                  <Link
                    href={`/explorer?host=${hostId}&database=${encodeURIComponent(database)}`}
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <Database className="size-3.5 shrink-0" />
                    <span
                      className={cn('truncate select-text', NAME_MAX_WIDTH)}
                    >
                      {database}
                    </span>
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="flex min-w-0 items-center gap-1.5">
                  <Database className="size-3.5 shrink-0" />
                  <span className={cn('truncate select-text', NAME_MAX_WIDTH)}>
                    {database}
                  </span>
                </BreadcrumbPage>
              )}
              {/* Stops the copy click from bubbling into the sibling database link/page above.
                  Hover/focus-revealed, matching the quiet copy-affordance convention
                  used elsewhere (e.g. ai-elements/message.tsx). */}
              <span
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
              >
                <CopyButton text={database} className="size-6 shrink-0 p-0" />
              </span>
            </BreadcrumbItem>
          </>
        )}

        {table && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="group min-w-0">
              <BreadcrumbPage className="flex min-w-0 items-center gap-1.5">
                <TableIcon className="size-3.5 shrink-0" />
                <span className={cn('truncate select-text', NAME_MAX_WIDTH)}>
                  {table}
                </span>
              </BreadcrumbPage>
              {/* Stops the copy click from bubbling into the sibling table page above.
                  Hover/focus-revealed, matching the quiet copy-affordance convention
                  used elsewhere (e.g. ai-elements/message.tsx). */}
              <span
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
              >
                <CopyButton text={table} className="size-6 shrink-0 p-0" />
              </span>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
