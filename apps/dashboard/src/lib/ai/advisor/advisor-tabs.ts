/** `/advisor` page tabs; Schema & Settings is the default. `?query=` / `?queryId=` still open Query Advisor; `?view=plan` opens Optimization plan. */

export const ADVISOR_TAB_SCHEMA = 'schema'
export const ADVISOR_TAB_QUERY = 'query'
export const ADVISOR_TAB_PLAN = 'plan'

export type AdvisorPageTab =
  | typeof ADVISOR_TAB_SCHEMA
  | typeof ADVISOR_TAB_QUERY
  | typeof ADVISOR_TAB_PLAN

export const ADVISOR_TABS: { value: AdvisorPageTab; label: string }[] = [
  { value: ADVISOR_TAB_SCHEMA, label: 'Schema & Settings' },
  { value: ADVISOR_TAB_QUERY, label: 'Query Advisor' },
  { value: ADVISOR_TAB_PLAN, label: 'Optimization plan' },
]

export const ADVISOR_DEFAULT_TAB: AdvisorPageTab = ADVISOR_TAB_SCHEMA

export function resolveAdvisorTab(search: {
  view?: string | null
  query?: string | null
  queryId?: string | null
}): AdvisorPageTab {
  const explicit = ADVISOR_TABS.find((tab) => tab.value === search.view)
  if (explicit) return explicit.value
  if (search.query || search.queryId) return ADVISOR_TAB_QUERY
  return ADVISOR_DEFAULT_TAB
}
