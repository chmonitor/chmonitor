import {
  BotMessageSquare,
  CircleX,
  ExternalLinkIcon,
  Lightbulb,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Row, RowData } from '@tanstack/react-table'

import type { Action } from './types'

import { useState } from 'react'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { useActions } from '@/lib/swr'
import { useHostId } from '@/lib/swr/use-host'

interface InlineActionsProps<TData extends RowData> {
  row: Row<TData>
  value: React.ReactNode
  actions: Action[]
}

const ACTION_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType }
> = {
  'kill-query': { label: 'Kill Query', icon: CircleX },
  'open-in-explorer': { label: 'Open in Explorer', icon: ExternalLinkIcon },
  'explain-query': { label: 'Explain Query', icon: Lightbulb },
  'analyze-with-ai': { label: 'Analyze with AI', icon: BotMessageSquare },
}

export function InlineActions<TData extends RowData>({
  row,
  value,
  actions,
}: InlineActionsProps<TData>) {
  const hostId = useHostId()
  const { killQuery } = useActions()
  const [killingId, setKillingId] = useState<string | null>(null)

  const getQuery = () =>
    String(row.getValue('query') || row.getValue('normalized_query') || '')

  const handleKill = async () => {
    const queryId = String(value)
    setKillingId(queryId)
    try {
      const result = await killQuery(queryId)
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to kill query')
    } finally {
      setKillingId(null)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5">
        {actions.map((action) => {
          const config = ACTION_CONFIG[action]
          if (!config) return null

          const Icon = config.icon

          if (action === 'kill-query') {
            const isKilling = killingId === String(value)
            return (
              <Tooltip key={action}>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={handleKill}
                      disabled={isKilling}
                    />
                  }
                >
                  {isKilling ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                </TooltipTrigger>
                <TooltipContent>{config.label}</TooltipContent>
              </Tooltip>
            )
          }

          // Link-based actions
          let href = ''
          if (action === 'open-in-explorer') {
            href = buildExplorerQueryUrl(getQuery(), hostId)
          } else if (action === 'explain-query') {
            href = `/explain?query=${encodeURIComponent(getQuery())}`
          } else if (action === 'analyze-with-ai') {
            href = `/agents?host=${hostId}`
          }

          return (
            <Tooltip key={action}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    render={<Link href={href} />}
                  />
                }
              >
                <Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{config.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
