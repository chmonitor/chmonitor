import { ArrowRight, BookOpen, Check, Star } from 'lucide-react'

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.9c-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.35 4.8-4.58 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  )
}

import { HeroRotatingSlogan } from '@/components/HeroRotatingSlogan'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const HERO_FEATURES = [
  'Real-time queries, merges and replication from system tables',
  'Running, slow and expensive query views with EXPLAIN',
  'Cluster topology, replica lag and Keeper health',
  'Disk, memory and merge backlog on one overview',
  'Threshold alerts to Slack, Opsgenie, PagerDuty and webhooks',
  'AI advisor for schema and tuning — MCP-ready, read-only default',
] as const

type Props = {
  starLabel?: string
  className?: string
}

export function HeroContent({ starLabel = '', className }: Props) {
  return (
    <section
      className={cn(
        'relative isolate overflow-hidden pb-16 sm:pb-20',
        className
      )}
      data-hero
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(ellipse_70%_50%_at_50%_-20%,color-mix(in_oklch,var(--primary)_8%,transparent),transparent)]"
      />

      <div className="relative mx-auto max-w-6xl px-6 pt-16 sm:pt-20 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href="https://github.com/chmonitor/chmonitor"
            target="_blank"
            rel="noopener"
            className="inline-flex"
            data-hero-oss
          >
            <Badge className="gap-2 rounded-full border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-emerald-700 text-sm font-medium dark:text-emerald-300">
              <GithubIcon className="size-4" />
              Open source · GPL-3.0 · self-host free
            </Badge>
          </a>

          <h1 className="mt-5 text-balance font-semibold text-[clamp(2.25rem,5.5vw,3.75rem)] text-foreground leading-[1.05] tracking-[-0.03em]">
            The ops dashboard for ClickHouse
            <span className="block text-primary">
              queries, merges, replication — live
            </span>
          </h1>

          <HeroRotatingSlogan />

          <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground text-sm leading-relaxed sm:text-base">
            Live dashboards from{' '}
            <span className="text-foreground">system.query_log</span>,{' '}
            <span className="text-foreground">system.parts</span>, and
            replication tables — self-hosted or on{' '}
            <span className="text-foreground">dash.chmonitor.dev</span>.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <a
              href="https://dash.chmonitor.dev"
              target="_blank"
              rel="noopener"
              data-cta="hero-primary"
              className={buttonVariants({ size: 'lg' })}
            >
              Start free
              <ArrowRight className="size-4" />
            </a>
            <a
              href="https://docs.chmonitor.dev"
              target="_blank"
              rel="noopener"
              data-cta="hero-self-host"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              <BookOpen className="size-4" />
              Self-host
            </a>
            {starLabel ? (
              <a
                href="https://github.com/chmonitor/chmonitor"
                target="_blank"
                rel="noopener"
                data-cta="github-star-hero"
                className={buttonVariants({ variant: 'ghost', size: 'lg' })}
              >
                <Star className="size-4" />
                <span className="tabular-nums">{starLabel}</span>
              </a>
            ) : null}
          </div>
        </div>

        <ul
          className="mx-auto mt-12 grid max-w-3xl list-none gap-x-8 gap-y-3 sm:grid-cols-2"
          data-hero-features
        >
          {HERO_FEATURES.map((feature) => (
            <li
              key={feature}
              className="flex gap-2.5 text-left text-foreground text-sm leading-snug"
            >
              <Check
                className="mt-0.5 size-4 shrink-0 text-emerald-500"
                strokeWidth={2.4}
                aria-hidden
              />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
