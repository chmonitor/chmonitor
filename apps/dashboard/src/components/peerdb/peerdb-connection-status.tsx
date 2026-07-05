import {
  CheckCircle2Icon,
  LoaderIcon,
  type LucideIcon,
  PlugZapIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from 'lucide-react'

import type { PeerDBStatusPayload } from '@/lib/peerdb/types'

import { usePeerDBStatus } from './use-peerdb-status'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type PillState = PeerDBStatusPayload['state'] | 'checking'

const META: Record<
  PillState,
  { label: string; icon: LucideIcon; className: string; message: string }
> = {
  checking: {
    label: 'Checking…',
    icon: LoaderIcon,
    className: 'border-transparent bg-muted text-muted-foreground',
    message: 'Probing the PeerDB API…',
  },
  connected: {
    label: 'Connected',
    icon: CheckCircle2Icon,
    className:
      'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    message: 'PeerDB API reachable and authenticated.',
  },
  'not-configured': {
    label: 'Not configured',
    icon: PlugZapIcon,
    className: 'border-transparent bg-muted text-muted-foreground',
    message: 'Set PEERDB_API_URL to enable PeerDB monitoring.',
  },
  auth: {
    label: 'Auth failed',
    icon: ShieldAlertIcon,
    className:
      'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    message:
      'PeerDB rejected the credentials. Check PEERDB_PASSWORD (the PeerDB UI login password).',
  },
  unreachable: {
    label: 'Unreachable',
    icon: XCircleIcon,
    className:
      'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    message:
      'Could not reach the PeerDB API. Check PEERDB_API_URL and network.',
  },
}

/**
 * Compact PeerDB API health pill. Hits the server-side /peerdb-status probe so
 * the tooltip can show the configured host and the exact failure reason without
 * the browser ever seeing credentials.
 */
export function PeerDBConnectionStatus() {
  const { data, isLoading } = usePeerDBStatus()

  const state: PillState =
    isLoading && !data ? 'checking' : (data?.state ?? 'unreachable')
  const meta = META[state]
  const Icon = meta.icon

  const detail =
    state === 'connected' && data?.version
      ? `PeerDB ${data.version}`
      : data?.error
  const tooltip = [
    meta.message,
    data?.host ? `Host: ${data.host}` : null,
    detail,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="outline"
              className={cn('gap-1.5', meta.className)}
            />
          }
        >
          <Icon
            className={cn('size-3', state === 'checking' && 'animate-spin')}
          />
          PeerDB: {meta.label}
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
