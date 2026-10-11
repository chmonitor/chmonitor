import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { baseOptions } from '@/lib/layout.shared'
import { dashboardUrl, gitConfig, siteUrl } from '@/lib/shared'

export const Route = createFileRoute('/')({
  component: HomePage,
  head: () => ({ links: [{ rel: 'canonical', href: siteUrl }] }),
})

interface DocLink {
  title: string
  href: string
  desc: string
}

interface DocSection {
  name: string
  href: string
  tagline: string
  links: DocLink[]
}

const SECTIONS: DocSection[] = [
  {
    name: 'Guide',
    href: '/guide',
    tagline: 'Install chmonitor, connect a cluster, and learn each feature.',
    links: [
      {
        title: 'Getting started',
        href: '/guide/getting-started',
        desc: 'Run the dashboard against your first ClickHouse host.',
      },
      {
        title: 'Features',
        href: '/guide/features',
        desc: 'Overview, queries, tables, cluster, explorer, and more.',
      },
      {
        title: 'AI agent',
        href: '/guide/ai-agent',
        desc: 'Ask natural-language questions grounded in live data.',
      },
      {
        title: 'Guides',
        href: '/guide/guides/troubleshooting',
        desc: 'Proxy auth, upgrades, and troubleshooting walkthroughs.',
      },
    ],
  },
  {
    name: 'Operate',
    href: '/operate',
    tagline: 'Deploy, secure, and tune chmonitor for production.',
    links: [
      {
        title: 'Deploy',
        href: '/operate/deploy',
        desc: 'Docker, Kubernetes, Cloudflare Workers, Vercel, Traefik.',
      },
      {
        title: 'Authentication',
        href: '/operate/authentication',
        desc: 'Public, Clerk, Cloudflare Access, or trusted-header.',
      },
      {
        title: 'Multiple hosts',
        href: '/operate/advanced/multiple-hosts',
        desc: 'Monitor several clusters from one deployment.',
      },
      {
        title: 'Feature permissions',
        href: '/operate/advanced/feature-permissions',
        desc: 'Per-feature access control and editions.',
      },
    ],
  },
  {
    name: 'Reference',
    href: '/reference',
    tagline: 'Configuration, APIs, integrations, and release history.',
    links: [
      {
        title: 'Configuration',
        href: '/reference/configuration',
        desc: 'Every setting that shapes the dashboard.',
      },
      {
        title: 'Environment variables',
        href: '/reference/environment-variables',
        desc: 'The full list of supported env vars.',
      },
      {
        title: 'MCP server',
        href: '/reference/mcp-server',
        desc: 'Expose monitoring tools to MCP-compatible clients.',
      },
      {
        title: 'Migrating to v0.3',
        href: '/reference/migrating/v0-3',
        desc: 'Upgrade notes from the Next.js-era app.',
      },
    ],
  },
]

function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16 sm:py-24">
        <Intro />
        <SectionGrid />
        <HelpRow />
      </main>
    </HomeLayout>
  )
}

function Intro() {
  return (
    <section className="max-w-2xl">
      <h1 className="text-balance font-normal text-[clamp(2rem,5vw,3rem)] leading-[1.06] tracking-tight">
        chmonitor documentation
      </h1>
      <p className="mt-5 text-pretty text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
        Install, operate, and extend chmonitor, a read-only ClickHouse
        dashboard powered by your{' '}
        <code className="text-fd-foreground">system.*</code> tables.
      </p>
      <a
        href="/guide/getting-started"
        className="mt-8 inline-flex items-center gap-1.5 rounded-lg bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
      >
        Get started
        <ArrowRight className="size-4" />
      </a>
    </section>
  )
}

// Three plain columns split by hairlines; no card chrome or icon tiles.
function SectionGrid() {
  return (
    <section className="mt-16 grid gap-10 border-t pt-10 sm:mt-20 md:grid-cols-3 md:gap-8">
      {SECTIONS.map(({ name, href, tagline, links }) => (
        <div key={name} className="flex flex-col">
          <a
            href={href}
            className="group inline-flex items-center gap-1.5 text-lg font-medium tracking-tight"
          >
            {name}
            <ArrowRight className="size-4 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </a>
          <p className="mt-2 text-sm text-fd-muted-foreground">{tagline}</p>
          <ul className="mt-5 flex flex-col gap-4">
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="group block">
                  <span className="text-sm font-medium group-hover:text-[var(--brand-ink)]">
                    {link.title}
                  </span>
                  <span className="mt-0.5 block text-sm text-fd-muted-foreground">
                    {link.desc}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function HelpRow() {
  const repo = `https://github.com/${gitConfig.user}/${gitConfig.repo}`
  const links = [
    { title: 'Live demo', href: dashboardUrl, external: true },
    {
      title: 'Troubleshooting',
      href: '/guide/guides/troubleshooting',
      external: false,
    },
    { title: 'FAQ', href: '/reference/faq', external: false },
    { title: 'GitHub', href: repo, external: true },
  ]
  return (
    <section className="mt-16 flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-8 text-sm text-fd-muted-foreground">
      <span>Need help?</span>
      {links.map(({ title, href, external }) => (
        <a
          key={title}
          href={href}
          {...(external
            ? { target: '_blank', rel: 'noreferrer noopener' }
            : {})}
          className="inline-flex items-center gap-0.5 font-medium text-fd-foreground hover:text-[var(--brand-ink)]"
        >
          {title}
          {external ? <ArrowUpRight className="size-3.5 opacity-60" /> : null}
        </a>
      ))}
    </section>
  )
}
