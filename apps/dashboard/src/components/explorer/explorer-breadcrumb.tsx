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

/** Small, quiet copy affordance revealed on hover of its breadcrumb crumb. */
const CRUMB_COPY_CLASS =
  'size-6 p-0 text-muted-foreground opacity-0 transition-opacity group-hover/crumb:opacity-100 focus-visible:opacity-100'

interface ExplorerBreadcrumbProps {
  hostName?: string
}

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
            <BreadcrumbItem className="group/crumb">
              {table ? (
                <BreadcrumbLink asChild>
                  <Link
                    href={`/explorer?host=${hostId}&database=${encodeURIComponent(database)}`}
                    className="flex items-center gap-1.5"
                  >
                    <Database className="size-3.5" />
                    {database}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="flex items-center gap-1.5">
                  <Database className="size-3.5" />
                  {database}
                </BreadcrumbPage>
              )}
              <CopyButton text={database} className={CRUMB_COPY_CLASS} />
            </BreadcrumbItem>
          </>
        )}

        {table && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="group/crumb">
              <BreadcrumbPage className="flex items-center gap-1.5">
                <TableIcon className="size-3.5" />
                {table}
              </BreadcrumbPage>
              <CopyButton text={table} className={CRUMB_COPY_CLASS} />
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
