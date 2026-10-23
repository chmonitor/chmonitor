/**
 * Links from the Users page to pages about one user, or about access in
 * general. Each link names the menu entry (`menuHref`) whose availability and
 * feature gate decide whether it shows, so a page the sidebar hides on this
 * host is hidden here too.
 *
 * Only pages with a real `user` URL filter get one: history-queries and
 * running-queries (filter schema, `user=eq:<name>`) and the per-user usage
 * page (`?user=`). Sessions, login attempts, access matrix and roles have no
 * user filter, so they open unfiltered. There are no quota or settings-profile
 * pages to link to.
 */

export interface UserLink {
  key: string
  label: string
  href: string
  /** Menu entry whose availability gates this link. */
  menuHref: string
}

const FAILED_TYPES = 'in:ExceptionBeforeStart,ExceptionWhileProcessing'

function withParams(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params).toString()}`
}

/** Pages about one user, pre-filtered to that user where the page supports it. */
export function buildUserLinks(hostId: number, user: string): UserLink[] {
  const host = String(hostId)
  // `excluded_users=` clears the default exclusion list, which would otherwise
  // hide a service account such as `default` even when filtered to it.
  const historyUser = { host, user: `eq:${user}`, excluded_users: '' }

  return [
    {
      key: 'usage',
      label: 'Usage detail',
      href: withParams('/usage/user', { host, user }),
      menuHref: '/usage',
    },
    {
      key: 'history',
      label: 'History queries',
      href: withParams('/history-queries', historyUser),
      menuHref: '/history-queries',
    },
    {
      key: 'failed',
      label: 'Failed queries',
      href: withParams('/history-queries', {
        ...historyUser,
        type: FAILED_TYPES,
      }),
      menuHref: '/history-queries',
    },
    {
      key: 'running',
      label: 'Running queries',
      href: withParams('/running-queries', { host, user: `eq:${user}` }),
      menuHref: '/running-queries',
    },
    ...buildUsersRelatedLinks(hostId).filter((link) => link.key !== 'usage'),
    {
      key: 'login-attempts',
      label: 'Login attempts',
      href: withParams('/security/login-attempts', { host }),
      menuHref: '/security/login-attempts',
    },
  ]
}

/** Access-control pages for the Users page header. Not user-specific. */
export function buildUsersRelatedLinks(hostId: number): UserLink[] {
  const host = String(hostId)
  return [
    {
      key: 'roles',
      label: 'Roles',
      href: withParams('/roles', { host }),
      menuHref: '/roles',
    },
    {
      key: 'access-matrix',
      label: 'Access matrix',
      href: withParams('/security/access-matrix', { host }),
      menuHref: '/security/access-matrix',
    },
    {
      key: 'sessions',
      label: 'Sessions',
      href: withParams('/security/sessions', { host }),
      menuHref: '/security/sessions',
    },
    {
      key: 'usage',
      label: 'Usage by user',
      href: withParams('/usage', { host }),
      menuHref: '/usage',
    },
  ]
}
