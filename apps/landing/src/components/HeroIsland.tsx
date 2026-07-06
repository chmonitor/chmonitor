import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Database,
  Expand,
  Search,
  Send,
  Star,
  Zap,
} from 'lucide-react'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogImage } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  agentDemoLinesForPrompt,
  HERO_DEMO_SUGGESTIONS,
} from '@/lib/agent-demo-response'
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
  const [promptDraft, setPromptDraft] = useState('')
  const [livePrompt, setLivePrompt] = useState<string | null>(null)
  const [agentPhase, setAgentPhase] = useState(0)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomId, setZoomId] = useState<string | null>(null)

  const activeTabData = HERO_DEMO_TABS.find((t) => t.id === activeTab)
  const zoomShot = zoomId ? resolveScreenshotZoom(GALLERY_SHOTS, zoomId) : null

  const agentLines = useMemo(
    () =>
      livePrompt
        ? agentDemoLinesForPrompt(livePrompt)
        : agentDemoLinesForPrompt(
            HERO_DEMO_TABS.find((t) => t.id === 'agent')?.prompt ?? ''
          ),
    [livePrompt]
  )

  useEffect(() => {
    if (activeTab !== 'agent' || !livePrompt) {
      setAgentPhase(0)
      return
    }
    setAgentPhase(0)
    const timers = [
      setTimeout(() => setAgentPhase(1), 400),
      setTimeout(() => setAgentPhase(2), 1400),
      setTimeout(() => setAgentPhase(3), 2600),
    ]
    return () => timers.forEach(clearTimeout)
  }, [activeTab, livePrompt])

  function submitPrompt(prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed) return
    setLivePrompt(trimmed)
    setPromptDraft(trimmed)
    setActiveTab('agent')
  }

  function openZoom(id: string) {
    setZoomId(id)
    setZoomOpen(true)
  }

  const displayPrompt =
    livePrompt ?? HERO_DEMO_TABS.find((t) => t.id === 'agent')?.prompt ?? ''

  return (
    <section className="relative isolate overflow-hidden" data-hero-demo>
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

        <div className="mt-14 sm:mt-16" data-hero-demo-input>
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

            <form
              className="mx-auto mt-6 flex max-w-2xl gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                submitPrompt(promptDraft)
              }}
            >
              <Input
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                placeholder="Ask about slow queries, replication lag, storage…"
                className="h-11 bg-background/80"
                aria-label="Ask the agent a question"
                data-hero-prompt-input
              />
              <button
                type="submit"
                className={buttonVariants({
                  size: 'lg',
                  className: 'shrink-0',
                })}
                aria-label="Send prompt to agent demo"
              >
                <Send className="size-4" />
              </button>
            </form>

            <div className="mx-auto mt-3 flex max-w-2xl flex-wrap justify-center gap-2">
              {HERO_DEMO_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full"
                  onClick={() => submitPrompt(suggestion)}
                >
                  <Badge
                    variant="outline"
                    className="cursor-pointer font-normal"
                  >
                    {suggestion}
                  </Badge>
                </button>
              ))}
            </div>

            {HERO_DEMO_TABS.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="mt-6">
                {tab.id === 'agent' && livePrompt ? (
                  <div
                    className="mx-auto mb-4 max-w-2xl space-y-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-left text-xs"
                    data-hero-agent-thread
                  >
                    <p>
                      <span className="font-medium text-muted-foreground">
                        You
                      </span>
                      <span className="ml-2 text-foreground">
                        {displayPrompt}
                      </span>
                    </p>
                    {agentPhase > 0 ? (
                      <div className="space-y-1">
                        {agentLines.slice(0, agentPhase).map((line) => (
                          <p
                            key={line}
                            className="text-foreground leading-relaxed"
                          >
                            <Bot className="mr-1 inline size-3 text-primary" />
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        <Bot className="mr-1 inline size-3" />
                        Agent thinking…
                      </p>
                    )}
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
                  <span className="pointer-events-none absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2.5 py-1.5 text-foreground text-xs opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100">
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
