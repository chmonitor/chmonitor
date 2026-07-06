import { ArrowRight, BookOpen, Play, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import '@/styles/globals.css'

// Cropped, frame-less feature shots (v0.3 dark set). No browser chrome — each
// card shows the feature content only. webp, ~68KB avg. `span` drives the bento
// grid: featured shots take two columns on wide viewports.
const features: { label: string; src: string; alt: string; span?: boolean }[] =
  [
    {
      label: 'Overview · AI Insights',
      src: '/landing-assets/overview-insights-dark.webp',
      alt: 'Overview with AI insights across replicas, merges and compression',
      span: true,
    },
    {
      label: 'AI Agent',
      src: '/landing-assets/ai-agent-new-dark.webp',
      alt: 'AI agent recommending partition keys, skip indexes and PREWHERE rewrites',
      span: true,
    },
    {
      label: 'Cluster Topology',
      src: '/landing-assets/cluster-topology-new-dark.webp',
      alt: 'Cluster topology map of shards and replicas',
    },
    {
      label: 'Query Heatmap',
      src: '/landing-assets/query-heatmap-dark.webp',
      alt: 'Query activity heatmap over time',
    },
    {
      label: 'Running Queries',
      src: '/landing-assets/running-queries-new-dark.webp',
      alt: 'Live running queries with real-time resource usage',
    },
    {
      label: 'Slow Queries',
      src: '/landing-assets/slow-queries-new-dark.webp',
      alt: 'Slow queries with occurrence chart and worst-first table',
    },
    {
      label: 'Memory-Peak Queries',
      src: '/landing-assets/queries-memory-dark.webp',
      alt: 'Queries ranked by peak memory usage',
    },
    {
      label: 'Explain Plan',
      src: '/landing-assets/explain-new-dark.webp',
      alt: 'EXPLAIN query plan tree',
    },
    {
      label: 'Storage',
      src: '/landing-assets/storage-new-dark.webp',
      alt: 'Storage overview: disk usage, compression and largest tables',
    },
    {
      label: 'Record Breakers',
      src: '/landing-assets/record-breakers-dark.webp',
      alt: 'Record breakers and cluster statistics',
    },
    {
      label: 'Data Explorer',
      src: '/landing-assets/data-explorer-new-dark.webp',
      alt: 'Data explorer table dependency graph',
    },
    {
      label: 'PeerDB Mirrors',
      src: '/landing-assets/peerdb-new-dark.webp',
      alt: 'PeerDB mirrors with replication status and peer topology',
    },
  ]

export default function HeroIsland({ starLabel = '' }: { starLabel?: string }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* token-driven ambient glow — no raster */}
      <div
        aria-hidden
        className="-z-10 pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_70%)]"
      />

      <div className="mx-auto max-w-5xl px-6 pt-20 pb-14 text-center sm:pt-24">
        <a
          href="https://github.com/chmonitor/chmonitor"
          target="_blank"
          rel="noopener"
          className="inline-block"
        >
          <Badge
            variant="secondary"
            className="cursor-pointer rounded-full px-3 py-1 text-sm font-normal"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            Live cluster telemetry · open source, GPL-3.0
            <ArrowRight className="ml-0.5 size-3.5" />
          </Badge>
        </a>

        <h1 className="mt-6 text-balance font-semibold text-4xl text-foreground leading-[1.05] tracking-tight sm:text-6xl">
          Monitor ClickHouse <span className="text-primary">as it runs</span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground leading-relaxed sm:text-lg">
          Live query, merge and replication visibility straight from your
          cluster's system tables — plus an AI agent that recommends partition
          keys, skip indexes and PREWHERE rewrites, and threshold alerts to any
          webhook. Self-host on Docker or K8s, or use the hosted Cloud.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://dash.chmonitor.dev"
            target="_blank"
            rel="noopener"
            data-cta="hero-primary"
            className={buttonVariants({ size: 'lg' })}
          >
            Open dashboard
            <ArrowRight className="size-4" />
          </a>
          <a
            href="https://dash.chmonitor.dev"
            target="_blank"
            rel="noopener"
            data-cta="hero-live-demo"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            <Play className="size-4" />
            Live demo
          </a>
          <a
            href="https://docs.chmonitor.dev"
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: 'ghost', size: 'lg' })}
          >
            <BookOpen className="size-4" />
            Quickstart
          </a>
          <a
            href="https://github.com/chmonitor/chmonitor"
            target="_blank"
            rel="noopener"
            data-cta="github-star-hero"
            aria-label={
              starLabel
                ? `Star chmonitor on GitHub — ${starLabel} stars`
                : 'Star chmonitor on GitHub'
            }
            className={buttonVariants({ variant: 'ghost', size: 'lg' })}
          >
            <Star className="size-4" />
            Star
            {starLabel ? (
              <span className="font-medium tabular-nums">{starLabel}</span>
            ) : null}
          </a>
        </div>
      </div>

      {/* Feature matrix — cropped, frame-less shots on a bento grid. */}
      <div className="mx-auto max-w-6xl px-6 pb-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {features.map((f, i) => (
            <figure
              key={f.src}
              className={cnCard(f.span)}
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            >
              <div className="overflow-hidden">
                <img
                  src={f.src}
                  alt={f.alt}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[16/10] w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <figcaption className="border-border/60 border-t px-3 py-2 text-left font-medium text-muted-foreground text-xs">
                {f.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

function cnCard(span?: boolean) {
  return [
    'group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-ring/40',
    'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500',
    span ? 'col-span-2' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
