/**
 * Unified logging system for chmonitor
 *
 * Uses Pino-compatible NDJSON (Newline Delimited JSON) format:
 * {"level":"info","time":1735633240000,"msg":"message","key":"value"}
 *
 * Log levels (Pino standard string enum):
 * - "trace" (10)
 * - "debug" (20)
 * - "info" (30)
 * - "warn" (40)
 * - "error" (50)
 *
 * Sources:
 * - https://betterstack.com/community/comparisons/pino-vs-winston/
 * - https://signoz.io/guides/pino-logger/
 * - https://uptrace.dev/glossary/structured-logging
 */

// ============================================================================
// Environment Detection
// ============================================================================

const isDevelopment =
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
const debugEnabled =
  typeof process !== 'undefined' && process.env?.DEBUG === 'true'

/**
 * Whether debug/info logging is active (development or DEBUG=true).
 * Exposed so callers can guard expensive work (e.g. serialization) that is
 * only needed to build debug log payloads, avoiding it entirely in production.
 */
export const isDebugEnabled = (): boolean => isDevelopment || debugEnabled

// ============================================================================
// Types
// ============================================================================

export interface ErrorContext {
  digest?: string
  component?: string
  action?: string
  userId?: string
  hostId?: number
  [key: string]: unknown
}

// Pino log levels (string enum)
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const LogLevel = {
  trace: 'trace' as const,
  debug: 'debug' as const,
  info: 'info' as const,
  warn: 'warn' as const,
  error: 'error' as const,
} as const

// ============================================================================
// Core Logging Functions
// ============================================================================

/**
 * Create a Pino-compatible log entry
 */
function createLogEntry(
  level: LogLevel,
  msg: string,
  extra?: Record<string, unknown>
): string {
  const entry = {
    level,
    time: Date.now(),
    msg,
    ...extra,
  }
  return JSON.stringify(entry)
}

/**
 * Debug logging (level: "debug") - only in development or DEBUG=true
 *
 * @example
 * debug('[API] Query execution', { hostId: 0, query: 'SELECT 1' })
 *
 * Output: {"level":"debug","time":1735633240000,"msg":"[API] Query execution","hostId":0,"query":"SELECT 1"}
 */
export const debug = (
  msg: string,
  data?: Record<string, unknown> | unknown
): void => {
  if (isDevelopment || debugEnabled) {
    const extra =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : { data }
    console.log(createLogEntry(LogLevel.debug, msg, extra))
  }
}

/**
 * Info logging (level: "info") - only in development or DEBUG=true
 *
 * @example
 * info('[API] Data fetched successfully', { rows: 100 })
 *
 * Output: {"level":"info","time":1735633240000,"msg":"[API] Data fetched successfully","rows":100}
 */
export const log = (
  msg: string,
  data?: Record<string, unknown> | unknown
): void => {
  if (isDevelopment || debugEnabled) {
    const extra =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : { data }
    console.log(createLogEntry(LogLevel.info, msg, extra))
  }
}

/**
 * Warning logging (level: "warn") - always outputs
 *
 * @example
 * warn('[API] Deprecated endpoint accessed', { path: '/old-api' })
 *
 * Output: {"level":"warn","time":1735633240000,"msg":"[API] Deprecated endpoint accessed","path":"/old-api"}
 */
export const warn = (
  msg: string,
  data?: Record<string, unknown> | unknown
): void => {
  const extra =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : { data }
  console.warn(createLogEntry(LogLevel.warn, msg, extra))
}

/**
 * Error logging (level: "error") - always outputs
 *
 * @example
 * error('[API] Query failed', err, { hostId: 0 })
 *
 * Output: {"level":"error","time":1735633240000,"msg":"[API] Query failed","err":{"name":"Error","message":"..."},"hostId":0}
 */
export const error = (
  msg: string,
  err?: Error | unknown,
  context?: ErrorContext
): void => {
  const extra: Record<string, unknown> = {}

  if (err instanceof Error) {
    extra.err = {
      name: err.name,
      message: err.message,
      stack: isDevelopment ? err.stack : undefined,
    }
  } else if (err !== undefined) {
    extra.err = err
  }

  if (context) {
    Object.assign(extra, context)
  }

  console.error(createLogEntry(LogLevel.error, msg, extra))
}

// ============================================================================
// Structured Error Logger Class
// ============================================================================

/**
 * Structured error logger for component-level error handling
 *
 * @example
 * ErrorLogger.logError(error, { component: 'Header', action: 'fetchHosts' })
 * ErrorLogger.logWarning('Cache miss', { key: 'hosts' })
 * ErrorLogger.logDebug('Rendering component', { props: { ... } })
 */
export class ErrorLogger {
  static logError(err: Error, context?: ErrorContext): void {
    const msg = `Error in ${context?.component || 'unknown'}${context?.action ? ` (${context.action})` : ''}`
    error(msg, err, context)
  }

  static logWarning(msg: string, context?: ErrorContext): void {
    warn(msg, context)
  }

  static logDebug(msg: string, data?: Record<string, unknown>): void {
    debug(msg, data)
  }
}

// ============================================================================
// Request Correlation
// ============================================================================

/**
 * Generate a unique request ID for request correlation and tracing
 * Format: uuid-like string with timestamp for uniqueness
 *
 * @returns A unique request ID string
 * @example
 * const requestId = generateRequestId()
 * // => "1735633240000-a1b2c3d4"
 */
export function generateRequestId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format error for display based on environment
 */
export function formatErrorForDisplay(error: Error & { digest?: string }): {
  title: string
  message: string
  details?: {
    stack?: string
    digest?: string
    name?: string
  }
} {
  if (isDevelopment) {
    let detailedMessage = error.message

    if (
      error.message.includes('No ClickHouse hosts configured') ||
      error.message.includes('CLICKHOUSE_HOST')
    ) {
      detailedMessage =
        `Environment Configuration Error:\n\n${error.message}\n\n` +
        `This means the CLICKHOUSE_HOST environment variable is not set or empty.\n` +
        `Check your .env.local file or deployment environment settings.\n` +
        `See the browser console for detailed debug logs.`
    } else if (error.message.includes('Invalid hostId')) {
      detailedMessage = `Configuration Error: ${error.message}`
    } else if (
      error.message.includes('table') &&
      error.message.includes('not')
    ) {
      detailedMessage = `Database Error: ${error.message}`
    } else if (error.message.includes('Cannot read properties')) {
      detailedMessage = `Runtime Error: ${error.message}\n\nThis usually indicates a configuration issue or missing data.`
    }

    return {
      title: `Error: ${error.name}`,
      message: detailedMessage,
      details: {
        stack: error.stack,
        digest: error.digest,
        name: error.name,
      },
    }
  }

  let userMessage =
    'An unexpected error occurred. Please try again or contact support if the issue persists.'
  let adminNote = ''

  if (
    error.message.includes('No ClickHouse hosts configured') ||
    error.message.includes('CLICKHOUSE_HOST')
  ) {
    userMessage =
      'Server configuration error. The database connection is not properly configured. Please contact your administrator.'
    adminNote =
      'Note for administrator: No ClickHouse hosts configured. Please set CLICKHOUSE_HOST environment variable. Check deployment environment settings or Cloudflare Workers environment variables.'
  } else if (error.message.includes('Invalid hostId')) {
    userMessage =
      'Invalid server configuration. Please contact your administrator.'
    adminNote = `Note for administrator: ${error.message}`
  } else if (error.message.includes('table')) {
    userMessage =
      'A required database table is not available. Please contact your administrator.'
    adminNote = `Note for administrator: ${error.message}`
  } else if (
    error.message.includes('network') ||
    error.message.includes('connection')
  ) {
    userMessage =
      'Unable to connect to the database. Please check your network connection and try again.'
    adminNote = `Note for administrator: ${error.message}`
  }

  return {
    title: 'Something went wrong',
    message: adminNote ? `${userMessage}\n\n${adminNote}` : userMessage,
    details: {
      digest: error.digest,
    },
  }
}
