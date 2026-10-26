/** One tab of the per-user usage page and the usage tables it shows. */
export interface UserUsageTab {
  value: string
  label: string
  tables: string[]
}

export const USER_USAGE_TABS: UserUsageTab[] = [
  {
    value: 'activity',
    label: 'Activity',
    tables: ['user-usage-daily', 'user-usage-hours'],
  },
  {
    value: 'data',
    label: 'Tables & queries',
    tables: ['user-usage-tables', 'user-usage-shapes'],
  },
  {
    value: 'clients',
    label: 'Clients',
    tables: ['user-usage-kinds', 'user-usage-interfaces', 'user-usage-clients'],
  },
  { value: 'errors', label: 'Errors', tables: ['user-usage-errors'] },
]

export const DEFAULT_USER_USAGE_TAB = 'activity'

/** The `?tab=` value when it names a tab, else the default. */
export function resolveUserUsageTab(param: string | null): string {
  return USER_USAGE_TABS.some((t) => t.value === param)
    ? (param as string)
    : DEFAULT_USER_USAGE_TAB
}
