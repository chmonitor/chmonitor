import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

import { appName, dashboardUrl, gitConfig, marketingUrl } from './shared'

type LinkItemType = NonNullable<BaseLayoutProps['links']>[number]

// Header-only (`on: 'nav'`) so DocsLayout does not duplicate these into the
// sidebar tab strip. Logo/title still goes to docs home (`/`).
export const siteCtaLinks: LinkItemType[] = [
  {
    type: 'main',
    text: 'Home',
    url: marketingUrl,
    external: true,
    on: 'nav',
  },
  {
    type: 'main',
    text: 'Dashboard',
    url: dashboardUrl,
    external: true,
    on: 'nav',
  },
]

const sectionLinks: LinkItemType[] = [
  {
    text: 'Getting Started',
    url: '/guide/getting-started',
    active: 'nested-url',
    on: 'nav',
  },
  {
    text: 'Features',
    url: '/guide/features',
    active: 'nested-url',
    on: 'nav',
  },
  {
    text: 'Reference',
    url: '/reference/environment-variables',
    active: 'nested-url',
    on: 'nav',
  },
  {
    text: 'Releases',
    url: '/reference/releases',
    active: 'nested-url',
    on: 'nav',
  },
]

// Shared nav/layout options used by both the home (HomeLayout) and docs
// (DocsLayout) pages so the top bar stays consistent across the site.
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-medium">
          <img
            src="/brand/logo-chmonitor.svg"
            alt=""
            width={22}
            height={22}
            className="shrink-0"
          />
          {appName}
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [...siteCtaLinks, ...sectionLinks],
  }
}
