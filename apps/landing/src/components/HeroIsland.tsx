import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Database,
  Expand,
  Play,
  Search,
  Star,
  Zap,
} from 'lucide-react'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogImage } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HERO_DEMO_TABS } from '@/lib/hero-demo'
import { resolveScreenshotZoom } from '@/lib/screenshot-zoom'
import '@/styles/globals.css'

const GALLERY_SHOTS = HERO_DEMO_TABS.map((tab) => ({
  id: tab.id,
  src: tab.screenshot.src,
  alt: tab.screenshot.alt,
  label: tab.label,
}))

const TAB_ICONS: Record<string, typeof Activity> = {
  overview: Activity,
  agent: Bot,
  queries: Search,
  health: Zap,
  explorer: Database,
}

export default function HeroIsland({ starLabel = '' }: { starLabel?: string }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [agentPhase, setAgentPhase] = useState(0)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomId, setZoomId] = useState<string | null>(null)

  const zoomShot = zoomId ? resolveScreenshotZoom(GALLERY_SHOTS, zoomId) : null

  useEffect(() => {
    if (activeTab !== 'agent') {
      setAgentPhase(0)
      return
    }
    setAgentPhase(0)
    const timers = [
      setTimeout(() => setAgentPhase(1), 600),
      setTimeout(() => setAgentPhase(2), 1800),
      setTimeout(() => setAgentPhase(3), 3200),
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
      <div className="mx-auto max-w-6xl px-6 pt-16 pb-10 sm:pt-20 lg:pt-24">
        <div className="grid items-end gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
          <div className="text-left">
            <a
              href="https://github.com/chmonitor/chmonitor"
              target="_blank"
              rel="noopener"
              className="inline-block"
            >
              <Badge
                variant="outline"
                className="rounded-full px-3 py-1 text-xs font-normal"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Open source · GPL-3.0
                <ArrowRight className="size-3" />
              </Badge>
            </a>

            <h1 className="mt-5 text-balance font-semibold text-foreground text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95] tracking-[-0.03em]">
              Your ClickHouse
              <br />
              <span className="text-primary">command center</span>
            </h1>

            <p className="mt-5 max-w-xl text-pretty text-base text-muted-foreground leading-relaxed sm:text-lg">
              Queries, merges, replication and health — live from system tables.
              An AI agent that reads your schema before recommending. Alerts to
              Slack, PagerDuty or any webhook.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
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

          <div className="relative">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start overflow-x-auto">
                {HERO_DEMO_TABS.map((tab) => {
                  const Icon = TAB_ICONS[tab.id] ?? Activity
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className="gap-1.5"
                    >
                      <Icon className="size-3.5" />
                      {tab.label}
                    </TabsTrigger>
                  )
                })}
              </TabsList>

              {HERO_DEMO_TABS.map((tab) => (
                <TabsContent key={tab.id} value={tab.id}>
                  <Card className="overflow-hidden border-border/60 bg-card/80 backdrop-blur-sm">
                    <CardContent className="p-0">
                      <div className="flex items-center justify-between gap-3 border-border/50 border-b px-4 py-3">
                        <div>
                          <p className="font-medium text-foreground text-sm">
                            {tab.headline}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {tab.description}
                          </p>
                        </div>
                        {tab.metrics ? (
                          <div className="hidden gap-4 sm:flex">
                            {tab.metrics.map((m) => (
                              <div key={m.label} className="text-right">
                                <p className="font-medium text-foreground text-sm tabular-nums">
                                  {m.value}
                                </p>
                                <p className="text-muted-foreground text-[11px]">
                                  {m.label}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {tab.id === 'agent' ? (
                        <div className="space-y-2 border-border/50 border-b px-4 py-3">
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 font-medium text-muted-foreground text-xs">
                              You
                            </span>
                            <p className="rounded-md bg-muted px-2.5 py-1.5 text-foreground text-xs">
                              {tab.prompt}
                            </p>
                          </div>
                          {agentPhase > 0 ? (
                            <div className="flex items-start gap-2">
                              <Bot className="mt-0.5 size-3.5 text-primary" />
                              <div className="space-y-1">
                                {agentLines.slice(0, agentPhase).map((line) => (
                                  <p
                                    key={line}
                                    className="text-foreground text-xs leading-relaxed"
                                  >
                                    {line}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="pl-5 text-muted-foreground text-xs">
                              Agent thinking…
                            </p>
                          )}
                        </div>
                      ) : null}

                      <button
                        type="button"
                        data-screenshot-zoom={tab.id}
                        className="group relative block w-full cursor-zoom-in"
                        onClick={() => openZoom(tab.id)}
                        aria-label={`Zoom ${tab.label} screenshot`}
                      >
                        <img
                          src={tab.screenshot.src}
                          alt={tab.screenshot.alt}
                          className="aspect-[16/10] w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.01]"
                        />
                        <span className="pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-foreground text-xs opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                          <Expand className="size-3" />
                          Zoom
                        </span>
                      </button>
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>

            <p className="mt-3 flex items-center gap-2 text-muted-foreground text-xs">
              <Play className="size-3" />
              Interactive preview — switch tabs to explore product surfaces
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 pb-14">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-medium text-foreground text-sm">
            Every surface, one dashboard
          </h2>
          <p className="text-muted-foreground text-xs">
            Click any shot to zoom
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {GALLERY_SHOTS.map((shot) => (
            <button
              key={shot.id}
              type="button"
              data-screenshot-zoom={shot.id}
              className="group cursor-zoom-in text-left"
              onClick={() => openZoom(shot.id)}
              aria-label={`Zoom ${shot.label}`}
            >
              <div className="overflow-hidden rounded-lg shadow-lg transition-transform duration-300 group-hover:scale-[1.02]">
                <img
                  src={shot.src}
                  alt={shot.alt}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[16/10] w-full object-cover object-top"
                />
              </div>
              <p className="mt-1.5 font-medium text-muted-foreground text-[11px]">
                {shot.label}
              </p>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="p-3">
          {zoomShot ? (
            <DialogImage src={zoomShot.src} alt={zoomShot.alt} />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
