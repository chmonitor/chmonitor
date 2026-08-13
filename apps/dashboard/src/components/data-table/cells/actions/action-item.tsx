import {
  CheckCircledIcon,
  ExclamationTriangleIcon,
  UpdateIcon,
} from '@radix-ui/react-icons'
import { toast } from 'sonner'
import type { Row, RowData } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'

import type { Action } from './types'

import { useState } from 'react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { useActions } from '@/lib/swr'
import { useHostId } from '@/lib/swr/use-host'
import { splitHref } from '@/lib/url/url-builder'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface ActionButtonProps<TData extends RowData, TValue> {
  row: Row<TData>
  action: Action
  value: TValue
}

export function ActionItem<TData extends RowData, TValue>({
  row,
  action,
  value,
}: ActionButtonProps<TData, TValue>) {
  const [status, updateStatus] = useState<
    'none' | 'loading' | 'success' | 'failed'
  >('none')
  const navigate = useNavigate()
  const hostId = useHostId()
  const { killQuery, optimizeTable, querySettings } = useActions()

  const availableActions: {
    [key: string]: {
      label: string
      handler: () => Promise<{ success: boolean; message: string }>
    }
  } = {
    'kill-query': {
      label: 'Kill Query',
      handler: () => killQuery(String(value)),
    },
    'explain-query': {
      label: 'Explain Query',
      handler: async () => {
        const query = row.getValue('query') || ''
        return {
          success: true,
          message: `/explain?query=${encodeURIComponent(String(query))}`,
        }
      },
    },
    'open-in-explorer': {
      label: 'Open in Explorer',
      handler: async () => {
        const query = String(
          row.getValue('query') || row.getValue('normalized_query') || ''
        )
        return {
          success: true,
          message: buildExplorerQueryUrl(query, hostId),
        }
      },
    },
    'analyze-with-ai': {
      label: 'Analyze with AI',
      handler: async () => ({
        success: true,
        message: `/agents?host=${hostId}`,
      }),
    },
    'generate-ai-prompt': {
      label: 'Generate AI Fix Prompt',
      handler: async () => {
        const data = row.original as Record<string, unknown>
        const table = String(data.table ?? value ?? '')
        const zkException = String(data.zookeeper_exception ?? '')
        const queueException = String(data.last_queue_update_exception ?? '')
        const isSessionExpired = String(data.is_session_expired ?? '')
        const absoluteDelay = String(data.absolute_delay ?? '')
        const logPointer = String(data.log_pointer ?? '')
        const replicaPath = String(data.replica_path ?? '')
        const zkPath = String(data.zookeeper_path ?? '')
        const totalReplicas = String(data.total_replicas ?? '')
        const activeReplicas = String(data.active_replicas ?? '')

        const lines: string[] = [
          `I have a ClickHouse replicated table \`${table}\` that is in read-only mode. Please help me diagnose and fix it.`,
          '',
          '## Replica Status',
          `- Table: \`${table}\``,
          `- Replica path: \`${replicaPath}\``,
          `- ZooKeeper path: \`${zkPath}\``,
          `- Total replicas: ${totalReplicas}`,
          `- Active replicas: ${activeReplicas}`,
          `- Absolute delay: ${absoluteDelay} seconds`,
          `- Log pointer: ${logPointer}`,
          `- Session expired: ${isSessionExpired}`,
        ]

        if (zkException) {
          lines.push('', '## ZooKeeper Exception', '```', zkException, '```')
        }
        if (queueException) {
          lines.push(
            '',
            '## Last Queue Update Exception',
            '```',
            queueException,
            '```'
          )
        }

        lines.push(
          '',
          '## Questions',
          '1. What is the root cause of this read-only state?',
          '2. What are the exact steps to restore this replica to read-write mode?',
          '3. Are there any ClickHouse SQL commands I should run to recover?',
          '4. How can I prevent this from happening again?'
        )

        const prompt = lines.join('\n')
        const success = await copyToClipboard(prompt)
        return success
          ? { success: true, message: 'AI prompt copied to clipboard' }
          : { success: false, message: 'Failed to copy prompt to clipboard' }
      },
    },
    optimize: {
      label: 'Optimize Table',
      handler: () => optimizeTable(String(value)),
    },
    'query-settings': {
      label: 'Query Settings',
      handler: () => querySettings(String(value)),
    },
    'view-resource-timeline': {
      label: 'View Resource Timeline',
      handler: async () => {
        const queryId = String(row.getValue('query_id') || value || '')
        return {
          success: true,
          message: `/query-metric-log?query_id=${encodeURIComponent(queryId)}&host=${hostId}`,
        }
      },
    },
  }

  const actionConfig = availableActions[action]
  if (!actionConfig) return null

  const { label, handler } = actionConfig

  const handleClick = async () => {
    updateStatus('loading')
    toast.loading('Loading...')

    try {
      const result = await handler()

      if (
        (action === 'explain-query' ||
          action === 'open-in-explorer' ||
          action === 'analyze-with-ai' ||
          action === 'view-resource-timeline') &&
        result.success
      ) {
        navigate(splitHref(result.message))
        return
      }

      if (result.success) {
        updateStatus('success')
        toast.dismiss()
        toast.success(result.message)
      } else {
        updateStatus('failed')
        toast.dismiss()
        toast.error(result.message)
      }
    } catch (e) {
      updateStatus('failed')
      toast.dismiss()
      toast.error(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  return (
    <DropdownMenuItem onClick={handleClick} className="cursor-pointer">
      {status === 'loading' && (
        <span className="flex flex-row items-center gap-2">
          <UpdateIcon className="size-4 animate-spin" /> {label}
        </span>
      )}

      {status === 'failed' && (
        <span className="flex flex-row items-center gap-2">
          <ExclamationTriangleIcon className="size-4 text-orange-500" /> {label}
        </span>
      )}

      {status === 'success' && (
        <span className="flex flex-row items-center gap-2">
          <CheckCircledIcon className="size-4 text-lime-600" /> {label}
        </span>
      )}

      {status === 'none' && <span>{label}</span>}
    </DropdownMenuItem>
  )
}
