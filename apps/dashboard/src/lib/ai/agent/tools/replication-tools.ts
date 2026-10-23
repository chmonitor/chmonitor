import { z } from 'zod'

import { hostIdSchema, readOnlyQuery, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'
import { getHostCapabilities } from '@/lib/health/capability-cache'
import {
  REPLICATION_NOT_USED_MESSAGE,
  usesReplication,
} from '@/lib/health/replication-usage'

export function createReplicationTools(hostId: number) {
  return {
    get_replication_status: dynamicTool({
      description:
        'Get per-table replication status including delay, queue size, and replica counts. Says so when the host uses no replication.',
      inputSchema: z.object({
        database: z
          .string()
          .optional()
          .default('')
          .describe('Filter by database name, or empty for all databases.'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { database = '', hostId: toolHostId } = input as {
          database?: string
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const capabilities = await getHostCapabilities(resolvedHostId)
        if (!usesReplication(capabilities)) {
          return {
            replicationUsed: false,
            message: `${REPLICATION_NOT_USED_MESSAGE}: no Replicated or SharedMergeTree table exists, so there is no replication status to report. This is not a healthy result.`,
            rows: [],
          }
        }
        return readOnlyQuery({
          query: `SELECT
            database,
            table,
            is_leader,
            is_readonly,
            absolute_delay,
            queue_size,
            inserts_in_queue,
            merges_in_queue,
            log_pointer,
            total_replicas,
            active_replicas
          FROM system.replicas
          WHERE ({database:String} = '' OR database = {database:String})
          ORDER BY absolute_delay DESC`,
          query_params: { database },
          hostId: resolvedHostId,
        })
      },
    }),
  }
}
