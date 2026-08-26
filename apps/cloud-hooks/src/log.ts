/**
 * Worker-safe structured logging for cloud-hooks — NDJSON to stdout/stderr,
 * matching the @chm/logger format for Workers Observability triage.
 */
import { error as logErrorImpl } from '@chm/logger'

type LogMeta = Record<string, unknown>

function emitInfo(msg: string, meta?: LogMeta): void {
  const entry = JSON.stringify({
    level: 'info',
    time: Date.now(),
    msg,
    ...meta,
  })
  console.log(entry)
}

/** Operational info (always emitted — production worker triage). */
export function logInfo(msg: string, meta?: LogMeta): void {
  emitInfo(msg, meta)
}

export function logError(
  msg: string,
  errOrMeta?: unknown,
  context?: LogMeta
): void {
  if (errOrMeta instanceof Error) {
    logErrorImpl(msg, errOrMeta, context)
    return
  }
  if (typeof errOrMeta === 'object' && errOrMeta !== null) {
    logErrorImpl(msg, undefined, errOrMeta as LogMeta)
    return
  }
  if (errOrMeta !== undefined) {
    logErrorImpl(msg, errOrMeta, context)
    return
  }
  logErrorImpl(msg, undefined, context)
}
