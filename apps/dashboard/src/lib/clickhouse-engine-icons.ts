/**
 * ClickHouse Engine Icon Utility
 *
 * Maps ClickHouse table engine names to appropriate Lucide icons
 * with categorization for visual differentiation in the explorer tree.
 *
 * @see https://clickhouse.com/docs/engines/table-engines
 */

import type { LucideIcon } from 'lucide-react'
import {
  Binary,
  BookOpen,
  Boxes,
  CloudCog,
  Database,
  Eye,
  FileText,
  FolderKanban,
  GitMerge,
  Layers,
  Link,
  MemoryStick,
  Network,
  Rabbit,
  RefreshCw,
  Server,
  TableIcon,
  Timer,
  Trash2,
  Waves,
} from 'lucide-react'

export type EngineCategory =
  | 'mergetree' // All MergeTree family (including Replicated/Shared variants)
  | 'log'
  | 'view'
  | 'materialized-view'
  | 'dictionary'
  | 'memory'
  | 'buffer'
  | 'distributed'
  | 'database-integration'
  | 'queue-integration'
  | 'cloud-storage'
  | 'data-lake'
  | 'utility'
  | 'unknown'

export interface EngineIconConfig {
  icon: LucideIcon
  category: EngineCategory
  label: string
  color?: string // Tailwind color class
}

const DATABASE_ENGINES = new Set([
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'SQLite',
  'ODBC',
  'JDBC',
  'ExternalDistributed',
  'MaterializedPostgreSQL',
  'EmbeddedRocksDB',
])

const QUEUE_ENGINES = new Set(['Kafka', 'RabbitMQ', 'NATS'])

const CLOUD_STORAGE_ENGINES = new Set([
  'S3',
  'S3Queue',
  'HDFS',
  'AzureBlobStorage',
  'GCS',
  'URL',
])

const DATA_LAKE_ENGINES = new Set(['Iceberg', 'DeltaLake', 'Hudi', 'Hive'])

const LOG_ENGINES = new Set(['TinyLog', 'StripeLog', 'Log'])

const MEMORY_ENGINES = new Set(['Memory', 'Set', 'Join'])

const MERGETREE_VARIANTS = new Set([
  'MergeTree',
  'ReplacingMergeTree',
  'SummingMergeTree',
  'AggregatingMergeTree',
  'CollapsingMergeTree',
  'VersionedCollapsingMergeTree',
  'GraphiteMergeTree',
  'CoalescingMergeTree',
])

/**
 * Check if engine is a MergeTree variant (including Replicated/Shared)
 */
function isMergeTreeFamily(engine: string): boolean {
  if (MERGETREE_VARIANTS.has(engine)) return true
  if (engine.startsWith('Replicated') || engine.startsWith('Shared')) {
    const baseEngine = engine.replace(/^(Replicated|Shared)/, '')
    return MERGETREE_VARIANTS.has(baseEngine)
  }
  return false
}

export function getEngineIconConfig(engine: string): EngineIconConfig {
  // MergeTree family (including Replicated*, Shared*) - standard table icon
  if (isMergeTreeFamily(engine)) {
    return {
      icon: TableIcon,
      category: 'mergetree',
      label: engine,
      // No color - standard table appearance
    }
  }

  // Views
  if (engine === 'View') {
    return {
      icon: Eye,
      category: 'view',
      label: 'View',
      color: 'text-gray-500',
    }
  }

  if (engine === 'MaterializedView') {
    return {
      icon: Layers,
      category: 'materialized-view',
      label: 'Materialized View',
      color: 'text-indigo-500',
    }
  }

  if (engine === 'LiveView') {
    return {
      icon: RefreshCw,
      category: 'view',
      label: 'Live View',
      color: 'text-green-500',
    }
  }

  if (engine === 'WindowView') {
    return {
      icon: Timer,
      category: 'view',
      label: 'Window View',
      color: 'text-amber-500',
    }
  }

  // Dictionary
  if (engine === 'Dictionary') {
    return {
      icon: BookOpen,
      category: 'dictionary',
      label: 'Dictionary',
      color: 'text-orange-500',
    }
  }

  // Database integrations
  if (DATABASE_ENGINES.has(engine)) {
    // Special icons for common databases
    if (engine === 'PostgreSQL' || engine === 'MaterializedPostgreSQL') {
      return {
        icon: Database,
        category: 'database-integration',
        label: 'PostgreSQL',
        color: 'text-sky-600',
      }
    }
    if (engine === 'MySQL') {
      return {
        icon: Database,
        category: 'database-integration',
        label: 'MySQL',
        color: 'text-orange-600',
      }
    }
    if (engine === 'MongoDB') {
      return {
        icon: Database,
        category: 'database-integration',
        label: 'MongoDB',
        color: 'text-green-600',
      }
    }
    return {
      icon: Database,
      category: 'database-integration',
      label: engine,
      color: 'text-slate-500',
    }
  }

  // Queue integrations
  if (QUEUE_ENGINES.has(engine)) {
    if (engine === 'Kafka') {
      return {
        icon: Waves,
        category: 'queue-integration',
        label: 'Kafka',
        color: 'text-slate-700',
      }
    }
    if (engine === 'RabbitMQ') {
      return {
        icon: Rabbit,
        category: 'queue-integration',
        label: 'RabbitMQ',
        color: 'text-orange-500',
      }
    }
    return {
      icon: Waves,
      category: 'queue-integration',
      label: engine,
      color: 'text-cyan-500',
    }
  }

  // Cloud storage
  if (CLOUD_STORAGE_ENGINES.has(engine)) {
    if (engine === 'S3' || engine === 'S3Queue') {
      return {
        icon: CloudCog,
        category: 'cloud-storage',
        label: engine === 'S3Queue' ? 'S3 Queue' : 'S3',
        color: 'text-amber-600',
      }
    }
    if (engine === 'URL') {
      return {
        icon: Link,
        category: 'cloud-storage',
        label: 'URL',
        color: 'text-blue-500',
      }
    }
    return {
      icon: CloudCog,
      category: 'cloud-storage',
      label: engine,
      color: 'text-sky-500',
    }
  }

  // Data lake
  if (DATA_LAKE_ENGINES.has(engine)) {
    return {
      icon: Waves,
      category: 'data-lake',
      label: engine,
      color: 'text-teal-500',
    }
  }

  if (LOG_ENGINES.has(engine)) {
    return {
      icon: FileText,
      category: 'log',
      label: engine,
      color: 'text-gray-500',
    }
  }

  // Memory engines
  if (MEMORY_ENGINES.has(engine)) {
    return {
      icon: MemoryStick,
      category: 'memory',
      label: engine,
      color: 'text-violet-500',
    }
  }

  // Buffer
  if (engine === 'Buffer') {
    return {
      icon: FolderKanban,
      category: 'buffer',
      label: 'Buffer',
      color: 'text-yellow-500',
    }
  }

  // Distributed engines
  if (engine === 'Distributed') {
    return {
      icon: Network,
      category: 'distributed',
      label: 'Distributed',
      color: 'text-blue-600',
    }
  }

  if (engine === 'Merge') {
    return {
      icon: GitMerge,
      category: 'distributed',
      label: 'Merge',
      color: 'text-purple-500',
    }
  }

  // Utility engines
  if (engine === 'Null') {
    return {
      icon: Trash2,
      category: 'utility',
      label: 'Null',
      color: 'text-gray-400',
    }
  }

  if (engine === 'File') {
    return {
      icon: FileText,
      category: 'utility',
      label: 'File',
      color: 'text-slate-500',
    }
  }

  if (engine === 'GenerateRandom') {
    return {
      icon: Binary,
      category: 'utility',
      label: 'Random Generator',
      color: 'text-pink-500',
    }
  }

  if (engine === 'Executable' || engine === 'ExecutablePool') {
    return {
      icon: Server,
      category: 'utility',
      label: 'Executable',
      color: 'text-red-500',
    }
  }

  if (engine === 'KeeperMap') {
    return {
      icon: Boxes,
      category: 'utility',
      label: 'Keeper Map',
      color: 'text-emerald-500',
    }
  }

  // TimeSeries (newer engine) - also uses standard table icon
  if (engine === 'TimeSeries') {
    return {
      icon: TableIcon,
      category: 'mergetree',
      label: 'Time Series',
      // No color - standard table appearance
    }
  }

  // Unknown/default - standard table appearance
  return {
    icon: TableIcon,
    category: 'unknown',
    label: engine || 'Table',
    // No color - standard table appearance
  }
}

export function getEngineIcon(engine: string): LucideIcon {
  return getEngineIconConfig(engine).icon
}

export function getEngineCategory(engine: string): EngineCategory {
  return getEngineIconConfig(engine).category
}

/**
 * Check if an engine is a view type
 */
export function isViewEngine(engine: string): boolean {
  const category = getEngineCategory(engine)
  return category === 'view' || category === 'materialized-view'
}

/**
 * Check if an engine is replicated
 */
export function isReplicatedEngine(engine: string): boolean {
  return engine.startsWith('Replicated')
}

/**
 * Check if an engine is cloud/shared
 */
export function isSharedEngine(engine: string): boolean {
  return engine.startsWith('Shared')
}

/**
 * Check if an engine is an integration (external data source)
 */
export function isIntegrationEngine(engine: string): boolean {
  const category = getEngineCategory(engine)
  return (
    category === 'database-integration' ||
    category === 'queue-integration' ||
    category === 'cloud-storage' ||
    category === 'data-lake'
  )
}
