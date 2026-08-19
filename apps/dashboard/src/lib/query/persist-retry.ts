import type {
  PersistedClient,
  PersistRetryer,
} from '@tanstack/react-query-persist-client'

/** Abort persist retries after this many quota evictions. */
export const PERSIST_RETRY_MAX_ERROR_COUNT = 5

/**
 * True when `setItem` failed because localStorage is over quota.
 * Matches the DOM `QuotaExceededError` name, the Firefox
 * `NS_ERROR_DOM_QUOTA_REACHED` name, and a message that names either.
 */
export function isQuotaExceededError(error: Error): boolean {
  if (error.name === 'QuotaExceededError') return true
  if (error.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  return (
    /quotaexceedederror/i.test(error.message) ||
    /quota exceeded/i.test(error.message) ||
    /exceeded the quota/i.test(error.message)
  )
}

function queryDataJsonSize(data: unknown): number {
  try {
    return JSON.stringify(data ?? null).length
  } catch {
    return 0
  }
}

/** Largest `state.data` (JSON size); oldest `dataUpdatedAt` wins a tie. */
function evictIndex(
  queries: PersistedClient['clientState']['queries']
): number {
  let best = 0
  let bestSize = -1
  let bestUpdatedAt = Number.POSITIVE_INFINITY
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    const size = queryDataJsonSize(query?.state.data)
    const updatedAt = query?.state.dataUpdatedAt ?? 0
    if (size > bestSize || (size === bestSize && updatedAt < bestUpdatedAt)) {
      best = i
      bestSize = size
      bestUpdatedAt = updatedAt
    }
  }
  return best
}

/**
 * PersistRetryer: on QuotaExceededError, drop the largest (or oldest) query
 * and return the trimmed client so `createSyncStoragePersister` retries
 * `setItem`. Abort when the error is not quota, nothing is left to evict, or
 * we have already retried {@link PERSIST_RETRY_MAX_ERROR_COUNT} times.
 */
export const retryPersistOnQuotaOverflow: PersistRetryer = ({
  persistedClient,
  error,
  errorCount,
}) => {
  if (errorCount > PERSIST_RETRY_MAX_ERROR_COUNT) return undefined
  if (!isQuotaExceededError(error)) return undefined

  const queries = persistedClient.clientState.queries
  if (queries.length === 0) return undefined

  const index = evictIndex(queries)
  return {
    ...persistedClient,
    clientState: {
      ...persistedClient.clientState,
      queries: queries.filter((_, i) => i !== index),
    },
  }
}
