/**
 * Centralized error handling utilities for card components
 *
 * Provides consistent error detection, classification, and messaging
 * across ChartError, MetricCard, and other card-based components.
 *
 * Handles three error sources:
 * - ApiError: From API layer responses
 * - FetchDataError: From ClickHouse client
 * - Error: Standard JavaScript errors
 */

import type { FetchDataError } from '@chm/clickhouse-client'
import type { EmptyStateVariant } from '@/components/ui/empty-state'
import type { ApiError } from './api/types'

import { ApiErrorType } from './api/types'
import {
  getGuidanceForMissingTables,
  type TableGuidance,
} from './table-guidance'

// ============================================================================
// Types
// ============================================================================

/**
 * All possible error types that can be handled by card components
 */
export type CardError = Error | ApiError | FetchDataError

/**
 * Unified error variant for EmptyState component
 */
export type CardErrorVariant =
  | 'error'
  | 'offline'
  | 'timeout'
  | 'table-missing'
  | 'permission'

/**
 * Map a {@link CardErrorVariant} to a variant the shared `EmptyState`
 * understands. `EmptyState` has no `permission` styling, so permission errors
 * fall back to the `error` look — the permission-specific title/description are
 * still supplied separately via {@link getCardErrorTitle} /
 * {@link getCardErrorDescription}.
 */
export function toEmptyStateVariant(
  variant: CardErrorVariant
): EmptyStateVariant {
  return variant === 'permission' ? 'error' : variant
}

/**
 * Standardized error styling configuration
 */
export interface CardErrorStyle {
  /** Border color classes */
  border: string
  /** Background color classes */
  background: string
  /** Whether to show destructive styling */
  isDestructive: boolean
}

// ============================================================================
// Error Detection & Classification
// ============================================================================

/**
 * Keywords that indicate different error types
 */
const ERROR_KEYWORDS = {
  offline: [
    'offline',
    'network',
    'fetch',
    'connection',
    'connect',
    'econnrefused',
    'enotfound',
    'etimedout',
  ],
  timeout: [
    'timeout',
    'timed out',
    'query timeout',
    'resource limits',
    'exceeded resource',
    'cpu/memory',
    'memory limit',
    // ClickHouse RECEIVED_EMPTY_DATA (1016): connection dropped mid-stream,
    // usually because the query ran past a proxy/Worker timeout window.
    'error code: 1016',
  ],
  permission: [
    'permission',
    'access denied',
    'unauthorized',
    '401',
    '403',
    'not_enough_privileges',
    'not enough privileges',
  ],
  tableMissing: [
    'table',
    "doesn't exist",
    'missing',
    'unknown table',
    'table_not_found',
  ],
} as const

/**
 * Detects the type of error from Error | ApiError | FetchDataError
 */
export function detectCardErrorVariant(error: CardError): CardErrorVariant {
  const apiError = error as ApiError
  const fetchError = error as FetchDataError
  const statusError = error as { status?: number }
  const message = error.message?.toLowerCase() ?? ''
  const type = (apiError.type ?? fetchError.type)?.toLowerCase() ?? ''

  // 1. Check explicit type fields first (most reliable)
  if (
    type === 'permission_error' ||
    apiError.type === ApiErrorType.PermissionError ||
    ERROR_KEYWORDS.permission.some((keyword) => message.includes(keyword))
  ) {
    return 'permission'
  }

  if (
    type === 'table_not_found' ||
    apiError.type === ApiErrorType.TableNotFound
  ) {
    return 'table-missing'
  }

  if (type === 'network_error' || apiError.type === ApiErrorType.NetworkError) {
    return 'offline'
  }

  // 2. Check for timeout / resource-limit keywords in message
  if (ERROR_KEYWORDS.timeout.some((keyword) => message.includes(keyword))) {
    return 'timeout'
  }

  // 2a. SQL identifier / missing-column errors are not timeouts. The table
  // API returns HTTP 500 for any query_error, which would otherwise become
  // a silent hourglass (#3121: unknown `system.tables.ttl`).
  if (
    message.includes('unknown identifier') ||
    message.includes('unknown column') ||
    message.includes('missing columns')
  ) {
    return 'error'
  }

  // 2b. Server / resource errors (HTTP 5xx, e.g. a Cloudflare Worker that
  // exceeded CPU/memory limits) are retryable and best surfaced as a "too
  // heavy" timeout-style error rather than a generic failure.
  if (
    typeof statusError.status === 'number' &&
    statusError.status >= 500 &&
    statusError.status !== 503
  ) {
    return 'timeout'
  }
  // 503 is reused for both upstream network errors and Worker resource limits;
  // treat it as offline only when nothing indicated a resource/timeout issue.
  if (statusError.status === 503) {
    return 'offline'
  }

  // 3. Check for offline/connection keywords
  if (ERROR_KEYWORDS.offline.some((keyword) => message.includes(keyword))) {
    return 'offline'
  }

  // 4. Check for table missing keywords
  if (
    ERROR_KEYWORDS.tableMissing.some((keyword) => message.includes(keyword))
  ) {
    return 'table-missing'
  }

  // 5. Default to generic error
  return 'error'
}

// ============================================================================
// Error Messages (Standardized)
// ============================================================================

/**
 * Standardized error messages for each variant
 */
const ERROR_MESSAGES: Record<
  CardErrorVariant,
  { title: string; description: string; short?: string }
> = {
  'table-missing': {
    title: 'Table not available',
    description:
      'This feature requires additional ClickHouse configuration or the system table does not exist on this cluster.',
    short: 'Required system table not configured.',
  },
  offline: {
    title: "You're offline",
    description:
      'Unable to connect to the server. Check your network connection and try again.',
    short: 'Cannot connect to server.',
  },
  timeout: {
    title: 'Request timed out',
    description:
      'The query took too long to execute. Try reducing the time range or simplifying your filters.',
    short: 'Query execution timed out.',
  },
  error: {
    title: 'Failed to load',
    description:
      'An unexpected error occurred while loading data. Please try again.',
    short: 'An error occurred.',
  },
  permission: {
    title: 'Permission Required',
    description:
      'The current ClickHouse user does not have sufficient privileges to query this system table. Contact your administrator to grant SELECT permissions.',
    short: 'Permission denied.',
  },
}

/**
 * Gets the standardized error description
 *
 * Falls back to the original error message if it's short enough,
 * otherwise uses the standardized message.
 */
export function getCardErrorDescription(
  error: CardError,
  variant: CardErrorVariant,
  compact: boolean = false
): string {
  // Use compact message if requested and available
  if (compact && ERROR_MESSAGES[variant].short) {
    return ERROR_MESSAGES[variant].short
  }

  // Use original message if it's short and helpful
  const originalMessage = error.message?.trim()
  if (
    originalMessage &&
    originalMessage.length < 100 &&
    originalMessage.length > 10
  ) {
    // Check if original message is generic/unhelpful
    const genericMessages = [
      'error',
      'failed',
      'unknown error',
      'an error occurred',
    ]
    const isGeneric = genericMessages.some((generic) =>
      originalMessage.toLowerCase().includes(generic)
    )
    if (!isGeneric) {
      return originalMessage
    }
  }

  // Use standardized message
  return ERROR_MESSAGES[variant].description
}

/**
 * Gets the standardized error title
 *
 * @param variant - The error variant
 * @param customTitle - Optional custom title to override default
 */
export function getCardErrorTitle(
  variant: CardErrorVariant,
  customTitle?: string
): string {
  return customTitle || ERROR_MESSAGES[variant].title
}

// ============================================================================
// Error Styling
// ============================================================================

/**
 * Gets the standardized styling for error cards
 *
 * @param variant - The error variant
 * @returns Style configuration object
 */
export function getCardErrorStyle(variant: CardErrorVariant): CardErrorStyle {
  switch (variant) {
    case 'error':
      return {
        border: 'border-destructive/30',
        background: 'bg-destructive/5',
        isDestructive: true,
      }
    case 'timeout':
      return {
        border: 'border-warning/30',
        background: 'bg-warning/5',
        isDestructive: false,
      }
    case 'offline':
      return {
        border: 'border-warning/30',
        background: 'bg-warning/5',
        isDestructive: false,
      }
    case 'table-missing':
      return {
        border: 'border-muted/30',
        background: 'bg-muted/30',
        isDestructive: false,
      }
    case 'permission':
      return {
        border: 'border-destructive/30',
        background: 'bg-destructive/5',
        isDestructive: true,
      }
  }
}

/**
 * Gets the CSS classes for error card styling
 *
 * Convenience function that returns border and background classes
 * for direct use in className props.
 *
 * @param variant - The error variant
 * @returns Combined CSS class string
 */
export function getCardErrorClassName(variant: CardErrorVariant): string {
  const style = getCardErrorStyle(variant)
  return `${style.border} ${style.background}`
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Checks if an error is retryable
 *
 * Timeouts and network errors are generally retryable.
 * Table missing and permission errors are not.
 */
export function isCardErrorRetryable(error: CardError): boolean {
  const variant = detectCardErrorVariant(error)
  return variant === 'offline' || variant === 'timeout'
}

/**
 * Checks if an error should show the "Retry" button
 *
 * Same as isCardErrorRetryable but provided for API clarity
 */
export function shouldShowRetryButton(error: CardError): boolean {
  return isCardErrorRetryable(error)
}

/**
 * Formats error for logging/debugging
 *
 * Extracts structured information for error tracking
 */
export function formatCardErrorForLogging(error: CardError): {
  variant: CardErrorVariant
  type: string
  message: string
  hasApiType: boolean
  hasFetchType: boolean
} {
  const apiError = error as ApiError
  const fetchError = error as FetchDataError

  return {
    variant: detectCardErrorVariant(error),
    type: apiError.type ?? fetchError.type ?? 'unknown',
    message: error.message ?? 'No message',
    hasApiType: Boolean(apiError.type),
    hasFetchType: Boolean(fetchError.type),
  }
}

// ============================================================================
// Table-Specific Guidance
// ============================================================================

/**
 * Extended error info with table-specific guidance
 */
export interface TableMissingInfo {
  /** Names of missing tables */
  missingTables: readonly string[]
  /** Guidance for enabling the tables */
  guidance?: TableGuidance
}

/**
 * Extracts missing table information and guidance from an error
 *
 * Returns undefined if the error is not a table-missing error
 * or if no missing tables can be identified.
 */
export function getTableMissingInfo(
  error: CardError
): TableMissingInfo | undefined {
  const variant = detectCardErrorVariant(error)
  if (variant !== 'table-missing') {
    return undefined
  }

  const apiError = error as ApiError & {
    missingTables?: readonly string[]
    details?: { missingTables?: readonly string[] }
  }

  // Check both error.missingTables and error.details.missingTables
  // SWR hooks store it in details, API responses may have it directly
  const missingTables =
    apiError.missingTables || apiError.details?.missingTables

  if (!missingTables || missingTables.length === 0) {
    return undefined
  }

  return {
    missingTables,
    guidance: getGuidanceForMissingTables(missingTables),
  }
}

// ============================================================================
// Version & Permission Helpers
// ============================================================================

export interface SimpleVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Parse a version string like "24.3.1.1" into simple major.minor.patch components
 */
export function parseSimpleVersion(versionStr: string): SimpleVersion {
  if (typeof versionStr !== 'string' || !versionStr) {
    return { major: 0, minor: 0, patch: 0 }
  }
  const parts = versionStr.split('.')
  return {
    major: parseInt(parts[0] || '0', 10),
    minor: parseInt(parts[1] || '0', 10),
    patch: parseInt(parts[2] || '0', 10),
  }
}

/**
 * Checks if current ClickHouse version is older than the required version
 */
export function isVersionOlder(current: string, required: string): boolean {
  try {
    const cur = parseSimpleVersion(current)
    const req = parseSimpleVersion(required)
    if (cur.major !== req.major) return cur.major < req.major
    if (cur.minor !== req.minor) return cur.minor < req.minor
    if (cur.patch !== req.patch) return cur.patch < req.patch
    return false
  } catch {
    return false
  }
}

/**
 * Extracts table name from ClickHouse permission error messages
 */
export function extractTableFromPermissionError(
  message: string
): string | undefined {
  // Match standard patterns like system.query_log or system.processes
  const match = message.match(/\b(?:system|default)\.[a-zA-Z0-9_]+/i)
  return match ? match[0] : undefined
}
