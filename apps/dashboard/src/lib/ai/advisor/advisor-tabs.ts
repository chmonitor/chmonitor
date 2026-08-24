/**
 * `/advisor` page tabs. Schema & Settings is first and the default.
 * Query Advisor stays available; `?query=` / `?queryId=` still open it.
 */

export const ADVISOR_TAB_SCHEMA = 'schema'
export const ADVISOR_TAB_QUERY = 'query'

export type AdvisorPageTab =
  | typeof ADVISOR_TAB_SCHEMA
  | typeof ADVISOR_TAB_QUERY

export const ADVISOR_TABS: { value: AdvisorPageTab; label: string }[] = [
  { value: ADVISOR_TAB_SCHEMA, label: 'Schema & Settings' },
  { value: ADVISOR_TAB_QUERY, label: 'Query Advisor' },
]

export const ADVISOR_DEFAULT_TAB: AdvisorPageTab = ADVISOR_TAB_SCHEMA

export function resolveAdvisorTab(search: {
  view?: string | null
  query?: string | null
  queryId?: string | null
}): AdvisorPageTab {
  if (search.view === ADVISOR_TAB_QUERY || search.view === ADVISOR_TAB_SCHEMA) {
    return search.view
  }
  if (search.query || search.queryId) return ADVISOR_TAB_QUERY
  return ADVISOR_DEFAULT_TAB
}
