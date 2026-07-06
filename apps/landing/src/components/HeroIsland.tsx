import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Database,
  Expand,
  Search,
  Star,
  Zap,
} from 'lucide-react'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogImage } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HERO_DEMO_TABS } from '@/lib/hero-demo'
import { resolveScreenshotZoom } from '@/lib/screenshot-zoom'
import { cn } from '@/lib/utils'
import '@/styles/globals.css'

const TAB_ICONS: Record<string, typeof Activity> = {
  overview: Activity,
  agent: Bot,
  queries: Search,
  health: Zap,
  explorer: Database,
}

const GALLERY_SHOTS = HERO_DEMO_TABS.map((tab) => ({
  id: tab.id,
  src: tab.screenshot.src,
  alt: tab.screenshot.alt,
  label: tab.label,
}))

export default function HeroIsland({ starLabel = '' }: { starLabel?: string }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [agentPhase, setAgentPhase] = useState(0)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomId, setZoomId] = useState<string | null>(null)

  const activeTabData = HERO_DEMO_TABS.find((t) => t.id === activeTab)
  const zoomShot = zoomId ? resolveScreenshotZoom(GALLERY_SHOTS, zoomId) : null

  useEffect(() => {
    if (activeTab !== 'agent') {
      setAgentPhase(0)
      return
    }
    setAgentPhase(0)
    const timers = [
      setTimeout(() => setAgentPhase(1), 500),
      setTimeout(() => setAgentPhase(2), 1600),
      setTimeout(() => setAgentPhase(3), 2800),
    ]
    return () => timers.forEach(clearTimeout)
  }, [activeTab])

  const agentLines = useMemo(
    () => [
      'Scanning system.query_log on host 2…',
      'Found 847 executions · p99 4.2s · peak memory 2.1 GiB',
      'Recommend: partition by toYYYYMM(event_date), add minmax skip index on user_id',
    ],
    []
  )

  function openZoom(id: string) {
    setZoomId(id)
    setZoomOpen(true)
  }

  return (
    <section className="relative isolate overflow-hidden" data-hero-demo>
      {/* Subtle top glow — x.ai / Cursor energy without gradient blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]"
      />

      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-6 sm:pt-24 lg:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href="https://github.com/chmonitor/chmonitor"
            target="_blank"
            rel="noopener"
            className="inline-block"
          >
            <Badge
              variant="outline"
              className="rounded-full border-border/80 bg-background/50 px-3 py-1 text-xs font-normal backdrop-blur-sm"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Open source · GPL-3.0
              <ArrowRight className="size-3" />
            </Badge>
          </a>

          <h1 className="mt-6 text-balance font-semibold text-foreground text-[clamp(2.75rem,7vw,5rem)] leading-[0.92] tracking-[-0.04em]">
            Your ClickHouse
            <br />
            <span className="text-primary">command center</span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground leading-relaxed sm:text-lg">
            Queries, merges, replication and health — live from system tables.
            An AI agent that reads your schema before recommending. Alerts to
            Slack, PagerDuty or any webhook.
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
              href="https://docs.chmonitor.dev"
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
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
              {starLabel ? (
                <span className="font-medium tabular-nums">{starLabel}</span>
              ) : (
                'Star on GitHub'
              )}
            </a>
          </div>
        </div>

        {/* Live demo — Cursor-style: tabs then full-bleed screenshot */}
        <div className="mt-14 sm:mt-16">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <TabsList className="h-auto w-full justify-center gap-0.5 rounded-none border-border/60 border-b bg-transparent p-0 sm:w-auto sm:justify-start">
                {HERO_DEMO_TABS.map((tab) => {
                  const Icon = TAB_ICONS[tab.id] ?? Activity
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className={cn(
                        'gap-1.5 rounded-none border-transparent border-b-2 bg-transparent px-4 py-2.5 shadow-none',
                        'data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none',
                        'hover:text-foreground'
                      )}
                    >
                      <Icon className="size-3.5" />
                      {tab.label}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
              {activeTabData ? (
                <p className="hidden text-muted-foreground text-xs sm:block">
                  {activeTabData.headline}
                </p>
              ) : null}
            </div>

            {HERO_DEMO_TABS.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="mt-6">
                {tab.id === 'agent' && agentPhase > 0 ? (
                  <div className="mb-4 flex flex-wrap items-start justify-center gap-x-6 gap-y-2 px-2 text-center text-xs">
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">You:</span>{' '}
                      {tab.prompt}
                    </span>
                    <span className="max-w-xl text-left text-foreground">
                      <Bot className="mr-1 inline size-3 text-primary" />
                      {agentLines.slice(0, agentPhase).join(' · ')}
                    </span>
                  </div>
                ) : null}

                <button
                  type="button"
                  data-screenshot-zoom={tab.id}
                  className="group relative mx-auto block w-full max-w-5xl cursor-zoom-in overflow-hidden rounded-xl shadow-2xl shadow-black/25 transition-transform duration-500 hover:scale-[1.005] dark:shadow-black/60"
                  onClick={() => openZoom(tab.id)}
                  aria-label={`Zoom ${tab.label} screenshot`}
                >
                  <img
                    src={tab.screenshot.src}
                    alt={tab.screenshot.alt}
                    className="aspect-[16/10] w-full object-cover object-top"
                  />
                  <span className="pointer-events-none absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2.5 py-1.5 text-foreground text-xs opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    <Expand className="size-3.5" />
                    Zoom
                  </span>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background/80 to-transparent"
                  />
                </button>

                <p className="mt-4 text-center text-muted-foreground text-xs">
                  {tab.description}
                </p>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="border-none bg-transparent p-0 shadow-none">
          {zoomShot ? (
            <DialogImage src={zoomShot.src} alt={zoomShot.alt} />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
