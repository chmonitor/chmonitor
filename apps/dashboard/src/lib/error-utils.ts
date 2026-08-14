import type { FetchDataError } from '@chm/clickhouse-client'

/**
 * Utility functions for handling and displaying ClickHouse errors
 */

/**
 * Creates a user-friendly error message based on the error type
 */
export function formatErrorMessage(error: FetchDataError): string {
  switch (error.type) {
    case 'column_not_found': {
      const cols = error.details?.missingColumns?.join(', ')
      return cols
        ? `Required columns not found: ${cols}. This ClickHouse build may not expose that metric.`
        : 'Required columns not found. This ClickHouse build may not expose that metric.'
    }

    case 'table_not_found': {
      const docs =
        'Checkout https://docs.chmonitor.dev/getting-started/clickhouse-enable-system-tables'
      if (
        error.details?.missingTables &&
        error.details.missingTables.length > 0
      ) {
        const tables = error.details.missingTables.join(', ')
        return `Required tables not found: ${tables}. ${docs}`
      }
      return `Required tables not found. ${docs}`
    }

    case 'permission_error':
      return 'Permission denied. Please check your ClickHouse user permissions.'

    case 'network_error':
      return 'Network connection error. Please check your ClickHouse server connectivity.'

    case 'validation_error':
      return `Validation error: ${error.message}`
    default:
      return error.message
  }
}

/**
 * Creates a user-friendly error title based on the error type
 */
export function formatErrorTitle(error: FetchDataError): string {
  switch (error.type) {
    case 'column_not_found':
      return 'Column Not Found'

    case 'table_not_found':
      return 'Table Not Found'

    case 'permission_error':
      return 'Permission Denied'

    case 'network_error':
      return 'Connection Error'

    case 'validation_error':
      return 'Validation Error'
    default:
      return 'Query Error'
  }
}

/**
 * Determines if an error should be shown to the user or silently handled
 */
export function shouldDisplayError(error: FetchDataError): boolean {
  // Table not found errors for optional queries should typically be handled silently
  // Only show them if explicitly requested
  if (error.type === 'table_not_found' || error.type === 'column_not_found') {
    return false
  }

  return true
}

/**
 * Gets documentation suggestion based on error type
 */
export function getErrorDocumentation(error: FetchDataError): string | null {
  switch (error.type) {
    case 'table_not_found':
      if (
        error.details?.missingTables?.some((table) =>
          table.includes('backup_log')
        )
      ) {
        return 'Backup logging is not enabled. More details: https://clickhouse.com/docs/operations/backup'
      }
      if (
        error.details?.missingTables?.some((table) =>
          table.includes('error_log')
        )
      ) {
        return 'Error logging is not enabled. More details: https://clickhouse.com/docs/operations/server-configuration-parameters/settings#error_log'
      }
      if (
        error.details?.missingTables?.some((table) =>
          table.includes('zookeeper')
        )
      ) {
        return 'ZooKeeper is not configured. This feature requires ZooKeeper for replication. More details: https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replication'
      }
      return 'This feature requires specific ClickHouse configuration or system tables. More details: https://docs.chmonitor.dev/getting-started/clickhouse-enable-system-tables'

    case 'permission_error':
      return 'Grant required permissions to your ClickHouse user account.'

    default:
      return null
  }
}

/**
 * Gets the appropriate variant for the ErrorAlert component based on error type
 */
export function getErrorVariant(
  error: FetchDataError
): 'default' | 'destructive' | 'warning' | 'info' {
  switch (error.type) {
    case 'column_not_found':
    case 'table_not_found':
      return 'warning'
    case 'permission_error':
      return 'destructive'
    case 'network_error':
      return 'info'
    case 'validation_error':
      return 'warning'
    default:
      return 'destructive'
  }
}
