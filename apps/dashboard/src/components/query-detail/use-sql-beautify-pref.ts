import { useEffect, useState } from 'react'

/**
 * Persisted SQL "Beautify" preference for the query-detail SQL block.
 * Shares the `'sql-beautify'` localStorage key with the DialogSQL /
 * CodeDialogFormat pattern so a user's beautify preference carries across
 * SQL surfaces (deliberately off by default — `sql-formatter` is ~484K and
 * only fetched on first toggle).
 *
 * The preference is applied after mount (not as the initial state) to avoid
 * an SSR/prerender hydration mismatch when localStorage disagrees with the
 * server-rendered default (false).
 */
const SQL_BEAUTIFY_KEY = 'sql-beautify'

function readSqlBeautifyPref(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(SQL_BEAUTIFY_KEY) === 'true'
  } catch {
    return false
  }
}

function writeSqlBeautifyPref(value: boolean) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SQL_BEAUTIFY_KEY, String(value))
  } catch {
    /* noop */
  }
}

export function useSqlBeautifyPref(): [boolean, (value: boolean) => void] {
  const [beautify, setBeautify] = useState(false)

  useEffect(() => {
    setBeautify(readSqlBeautifyPref())
  }, [])

  const setAndPersist = (value: boolean) => {
    setBeautify(value)
    writeSqlBeautifyPref(value)
  }

  return [beautify, setAndPersist]
}
