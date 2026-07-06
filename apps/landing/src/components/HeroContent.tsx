import { ArrowRight, BookOpen, Check, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { HeroRotatingSlogan } from '@/components/HeroRotatingSlogan'
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
      className={cn('relative isolate overflow-hidden pb-16 sm:pb-20', className)}
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
            className="inline-block"
          >
            <Badge
              variant="outline"
              className="rounded-full bg-background/50 px-3 py-1 text-xs font-normal"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Open source · GPL-3.0
            </Badge>
          </a>

          <h1 className="mt-5 text-balance font-semibold text-[clamp(2rem,5vw,3.5rem)] text-foreground leading-[1.08] tracking-[-0.03em]">
            UI monitoring for ClickHouse
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