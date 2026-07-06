import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'

import appCss from '../styles.css?url'
import { type ReactNode, useEffect } from 'react'
import { ClerkAuthProvider } from '@/components/clerk/clerk-auth-provider'
import { WebMcpRegistration } from '@/components/webmcp'
import { SignupAnalyticsTracker } from '@/lib/analytics/signup-tracker'
import { isClerkClientEnabled } from '@/lib/clerk/clerk-client'
import { AppProvider } from '@/lib/context/app-context'
import { BrowserConnectionsProvider } from '@/lib/context/browser-connections-context'
import { TimeRangeProvider } from '@/lib/context/time-range-context'
import { TimezoneProvider } from '@/lib/context/timezone-context'
import { FeaturePermissionsProvider } from '@/lib/feature-permissions/context'
import { UserConnectionsCacheGuard } from '@/lib/hooks/user-connections-cache-guard'
import { QueryProvider } from '@/lib/query/provider'
import { ThemeProvider } from '@/lib/theme/theme-provider'

// Typed global `?host=` search param, declared on the ROOT so every route
// inherits it and useHostId can read it via useSearch({ strict: false }).
// Mirrors the Next app's host parsing (Number() coerce, fall back to 0).
interface RootSearch {
  host: number
}

// schema.org JSON-LD. `alternateName` lists the brand's keyword variations so
// search engines map "ch monitor" / "ch monitoring" / "ClickHouse monitoring
// UI" to chmonitor — and the WebApplication type helps Google render a richer
// result (and brand sitelinks).
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'chmonitor',
  alternateName: [
    'ch monitor',
    'ch monitoring',
    'ClickHouse Monitoring UI',
    'ClickHouse Monitoring Dashboard',
    'ClickHouse UI',
  ],
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  url: 'https://dash.chmonitor.dev/',
  description:
    'Open-source ClickHouse monitoring UI — real-time dashboards for cluster metrics, query performance, merges, replication and health.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  sameAs: ['https://github.com/chmonitor/chmonitor'],
} as const

function validateSearch(search: Record<string, unknown>): RootSearch {
  const raw = search.host
  const parsed = Number(raw)
  return {
    host:
      raw === undefined || raw === null || Number.isNaN(parsed) ? 0 : parsed,
  }
}

export const Route = createRootRoute({
  validateSearch,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'chmonitor — ClickHouse Monitoring Dashboard & UI' },
      {
        name: 'description',
        content:
          'chmonitor — open-source ClickHouse monitoring dashboard & UI. Track cluster metrics, slow queries, merges, replication and health in real time. Free, self-hosted.',
      },
      {
        name: 'keywords',
        content:
          'chmonitor, ch monitor, ch monitoring, ClickHouse monitoring, ClickHouse monitoring UI, ClickHouse monitoring dashboard, ClickHouse dashboard, ClickHouse UI, ClickHouse metrics',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'chmonitor' },
      { property: 'og:url', content: 'https://dash.chmonitor.dev/' },
      {
        property: 'og:title',
        content: 'chmonitor — ClickHouse Monitoring Dashboard & UI',
      },
      {
        property: 'og:description',
        content:
          'Open-source ClickHouse monitoring dashboard & UI. Track cluster metrics, slow queries, merges, replication and health in real time. Free, self-hosted.',
      },
      {
        name: 'twitter:title',
        content: 'chmonitor — ClickHouse Monitoring Dashboard & UI',
      },
      {
        name: 'twitter:description',
        content:
          'Open-source ClickHouse monitoring dashboard & UI. Track cluster metrics, slow queries, merges, replication and health in real time. Free, self-hosted.',
      },
      { property: 'og:image', content: 'https://dash.chmonitor.dev/og/og.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      {
        name: 'twitter:image',
        content: 'https://dash.chmonitor.dev/og/og.png',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16.png',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
    ],
  }),
  component: RootComponent,
})

// Inject schema.org JSON-LD via a client effect rather than as JSX in <head>.
// The SPA prerender does not serialize a raw <script> into the static shell, so
// rendering one in the React tree causes a hydration mismatch (React #418).
// Appending to document.head post-mount keeps it out of the reconciled tree —
// Googlebot executes effects and reads the structured data.
function StructuredData() {
  useEffect(() => {
    const el = document.createElement('script')
    el.type = 'application/ld+json'
    el.text = JSON.stringify(STRUCTURED_DATA)
    el.setAttribute('data-chm-jsonld', '')
    document.head.appendChild(el)
    return () => {
      el.remove()
    }
  }, [])
  return null
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

// Root renders the full HTML document (the SPA shell in SPA mode). Providers
// mount client-side: ThemeProvider > QueryProvider (TanStack Query).
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background font-sans antialiased">
        <StructuredData />
        <WebMcpRegistration />
        <ClerkAuthProvider>
          <TimezoneProvider>
            <ThemeProvider>
              <TimeRangeProvider>
                <QueryProvider>
                  {isClerkClientEnabled() ? (
                    <>
                      <UserConnectionsCacheGuard />
                      <SignupAnalyticsTracker />
                    </>
                  ) : null}
                  <BrowserConnectionsProvider>
                    <AppProvider>
                      <FeaturePermissionsProvider>
                        {children}
                      </FeaturePermissionsProvider>
                    </AppProvider>
                  </BrowserConnectionsProvider>
                </QueryProvider>
              </TimeRangeProvider>
            </ThemeProvider>
          </TimezoneProvider>
        </ClerkAuthProvider>
        <Scripts />
      </body>
    </html>
  )
}
