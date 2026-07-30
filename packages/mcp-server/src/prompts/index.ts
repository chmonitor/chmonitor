import { z } from 'zod'

import type { McpServer } from '@modelcontextprotocol/server'

const DISK_USAGE_THRESHOLD_PERCENT = 80
const LONG_RUNNING_QUERY_SECONDS = 30
const HIGH_PART_COUNT_THRESHOLD = 300
const REPLICATION_LAG_THRESHOLD_SECONDS = 300
const OLD_PARTS_DAYS = 30
const SLOW_QUERY_TOP_N = 10
const REPEATED_PATTERN_MIN_COUNT = 5
const LARGE_SCAN_MIN_ROWS = 1_000_000
const LARGE_SCAN_MAX_RESULTS = 100
const HIGH_MEMORY_USAGE_GB = 1
const SLOW_PATTERN_TOP_N = 3
const TOP_TABLES_BY_SIZE = 10
const STORAGE_CRITICAL_PERCENT = 80

/**
 * Registers MCP prompts for ClickHouse DBA monitoring tasks.
 *
 * Prompts registered:
 * - health-check: Comprehensive server health assessment
 * - slow-query-analysis: Query performance analysis
 * - storage-audit: Storage and compression audit
 * - replication-check: Replication health verification
 * - capacity-report: Capacity trend analysis
 *
 * @param server - The MCP server instance to register prompts on
 * @returns void
 */
export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'health-check',
    {
      title: 'Health Check',
      description: 'Run a comprehensive ClickHouse health check',
      argsSchema: {
        hostId: z.number().optional().describe('Host index (default: 0)'),
      },
    },
    async ({ hostId }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Perform a health check on ClickHouse host ${hostId ?? 0}:
1. Get server metrics (version, uptime, connections)
2. Check disk usage and warn if any disk is >${DISK_USAGE_THRESHOLD_PERCENT}% full
3. List any currently running queries taking >${LONG_RUNNING_QUERY_SECONDS}s
4. Check for stuck mutations
5. Report replication lag if replicated tables exist
Summarize findings with severity levels (OK/WARNING/CRITICAL).`,
          },
        },
      ],
    })
  )

  server.registerPrompt(
    'slow-query-analysis',
    {
      title: 'Slow Query Analysis',
      description: 'Analyze slow queries and suggest optimizations',
      argsSchema: {
        hostId: z.number().optional().describe('Host index (default: 0)'),
        lastHours: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of hours to look back (default: 24)'),
      },
    },
    async ({ hostId, lastHours }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Analyze slow queries on ClickHouse host ${hostId ?? 0} from the last ${lastHours ?? 24} hours:
1. Get the top ${SLOW_QUERY_TOP_N} slowest queries by duration from system.query_log
2. Identify repeated query patterns (similar fingerprints appearing >${REPEATED_PATTERN_MIN_COUNT} times)
3. For each slow pattern, check if the target tables have appropriate indexes
4. Look for queries scanning >${LARGE_SCAN_MIN_ROWS.toLocaleString()} rows that return <${LARGE_SCAN_MAX_RESULTS} rows (missing index signals)
5. Check for queries with high memory usage (>${HIGH_MEMORY_USAGE_GB}GB)
Provide optimization suggestions for the top ${SLOW_PATTERN_TOP_N} most impactful patterns.`,
          },
        },
      ],
    })
  )

  server.registerPrompt(
    'storage-audit',
    {
      title: 'Storage Audit',
      description: 'Audit storage usage, part health, and compression',
      argsSchema: {
        hostId: z.number().optional().describe('Host index (default: 0)'),
      },
    },
    async ({ hostId }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Audit storage on ClickHouse host ${hostId ?? 0}:
1. Check disk usage across all disks and warn if any is >${DISK_USAGE_THRESHOLD_PERCENT}% full
2. List the top ${TOP_TABLES_BY_SIZE} tables by total size (compressed and uncompressed)
3. Calculate compression ratios for the largest tables
4. Identify tables with >${HIGH_PART_COUNT_THRESHOLD} active parts (part count health)
5. Find tables with parts older than ${OLD_PARTS_DAYS} days that haven't been merged
6. Check for any detached parts that may need cleanup
Summarize with storage efficiency score and recommended actions.`,
          },
        },
      ],
    })
  )

  server.registerPrompt(
    'replication-check',
    {
      title: 'Replication Check',
      description: 'Check replication health across replicated tables',
      argsSchema: {
        hostId: z.number().optional().describe('Host index (default: 0)'),
      },
    },
    async ({ hostId }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Check replication health on ClickHouse host ${hostId ?? 0}:
1. List all replicated tables with their replication status
2. Check for any readonly replicas (is_readonly = 1)
3. Report replication lag (absolute_delay) and warn if >${REPLICATION_LAG_THRESHOLD_SECONDS} seconds
4. Check replication queue depth (queue_size, inserts_in_queue, merges_in_queue)
5. Verify leader election status across replicas
6. Look for any replication errors in recent logs
Summarize replication health with severity levels (OK/WARNING/CRITICAL).`,
          },
        },
      ],
    })
  )

  server.registerPrompt(
    'capacity-report',
    {
      title: 'Capacity Report',
      description: 'Analyze capacity trends and project future needs',
      argsSchema: {
        hostId: z.number().optional().describe('Host index (default: 0)'),
        lastDays: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of days to analyze (default: 30)'),
      },
    },
    async ({ hostId, lastDays }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Generate a capacity report for ClickHouse host ${hostId ?? 0} covering the last ${lastDays ?? 30} days:
1. Get current disk usage and total capacity
2. Analyze storage growth by checking table sizes over time
3. Check query volume trends from system.query_log (queries per hour/day)
4. Measure peak memory usage and connection counts
5. Identify the fastest-growing tables by row count and byte size
6. Project when current storage will reach ${STORAGE_CRITICAL_PERCENT}% based on growth rate
Provide a capacity summary with projected dates for resource thresholds.`,
          },
        },
      ],
    })
  )
}
