import { ArrowRight, BookOpen, Bot, Expand, Send, Star } from 'lucide-react'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogImage } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  agentDemoLinesForPrompt,
  HERO_DEMO_SUGGESTIONS,
} from '@/lib/agent-demo-response'
import { HERO_DEMO_TABS } from '@/lib/hero-demo'
import { resolveScreenshotZoom } from '@/lib/screenshot-zoom'
import { cn } from '@/lib/utils'
import '@/styles/globals.css'

const GALLERY_SHOTS = HERO_DEMO_TABS.map((tab) => ({
  id: tab.id,
  src: tab.screenshot.src,
  alt: tab.screenshot.alt,
  label: tab.label,
}))

export default function HeroIsland({ starLabel = '' }: { starLabel?: string }) {
  const [activeTab, setActiveTab] = useState('agent')
  const [promptDraft, setPromptDraft] = useState(HERO_DEMO_SUGGESTIONS[0])
  const [livePrompt, setLivePrompt] = useState<string | null>(null)
  const [agentPhase, setAgentPhase] = useState(0)
  const [zoomOpen, setZoomOpen] = useState(false)

  const activeTabData =
    HERO_DEMO_TABS.find((t) => t.id === activeTab) ?? HERO_DEMO_TABS[0]
  const zoomShot = resolveScreenshotZoom(GALLERY_SHOTS, activeTab)

  const agentLines = useMemo(
    () =>
      agentDemoLinesForPrompt(
        livePrompt ??
          HERO_DEMO_TABS.find((t) => t.id === 'agent')?.prompt ??
          ''
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
      setTimeout(() => setAgentPhase(1), 350),
      setTimeout(() => setAgentPhase(2), 1200),
      setTimeout(() => setAgentPhase(3), 2200),
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

  const showAgentThread = activeTab === 'agent' && livePrompt

  return (
    <section className="relative isolate overflow-hidden pb-8" data-hero-demo>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_70%_50%_at_50%_-20%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent)]"
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

          <h1 className="mt-5 text-balance font-semibold text-[clamp(2.25rem,5.5vw,3.75rem)] text-foreground leading-[1.05] tracking-[-0.03em]">
            The AI ops agent for ClickHouse
            <span className="block text-primary">— everywhere it runs</span>
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground text-sm leading-relaxed sm:text-base">
            Slow queries, merges, replication lag — live from system tables, with
            an advisor that tells you what to change.
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

        {/* Product canvas — screenshot dominates, chrome stays minimal */}
        <div className="relative mx-auto mt-10 w-full max-w-[1080px]" data-hero-demo-input>
          <div className="mb-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {HERO_DEMO_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'text-sm transition-colors',
                  activeTab === tab.id
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-screenshot-zoom={activeTab}
            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg shadow-[0_32px_100px_-20px_rgba(0,0,0,0.45)] transition-transform duration-700 ease-out hover:scale-[1.006] dark:shadow-[0_32px_100px_-20px_rgba(0,0,0,0.75)]"
            onClick={() => setZoomOpen(true)}
            aria-label={`Zoom ${activeTabData.label} screenshot`}
          >
            {HERO_DEMO_TABS.map((tab) => (
              <img
                key={tab.id}
                src={tab.screenshot.src}
                alt={tab.screenshot.alt}
                className={cn(
                  'aspect-[16/9] w-full object-cover object-top transition-opacity duration-500',
                  tab.id === activeTab
                    ? 'relative opacity-100'
                    : 'pointer-events-none absolute inset-0 opacity-0'
                )}
              />
            ))}

            {showAgentThread ? (
              <div
                className="absolute inset-x-0 bottom-[4.5rem] bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pt-12 pb-2 text-left sm:bottom-[5rem]"
                data-hero-agent-thread
              >
                {agentPhase > 0 ? (
                  <div className="space-y-1">
                    {agentLines.slice(0, agentPhase).map((line) => (
                      <p
                        key={line}
                        className="text-white/90 text-xs leading-relaxed sm:text-sm"
                      >
                        <Bot className="mr-1.5 inline size-3.5 text-primary" />
                        {line}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-white/70 text-xs sm:text-sm">
                    <Bot className="mr-1.5 inline size-3.5" />
                    Agent thinking…
                  </p>
                )}
              </div>
            ) : null}

            {activeTab === 'agent' ? (
              <form
                className="absolute inset-x-3 bottom-3 flex gap-2 sm:inset-x-4 sm:bottom-4"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault()
                  submitPrompt(promptDraft)
                }}
              >
                <Input
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  placeholder="Ask about slow queries, replication lag, storage…"
                  className="h-10 flex-1 rounded-lg border-0 bg-white/95 px-4 text-foreground text-sm shadow-lg backdrop-blur-sm dark:bg-neutral-900/95 dark:text-white"
                  aria-label="Ask the agent a question"
                  data-hero-prompt-input
                />
                <button
                  type="submit"
                  className={buttonVariants({
                    size: 'icon',
                    className: 'size-10 shrink-0 rounded-lg shadow-lg',
                  })}
                  aria-label="Send prompt"
                >
                  <Send className="size-4" />
                </button>
              </form>
            ) : null}

            <span className="pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1 rounded-md bg-black/50 px-2 py-1 text-white/90 text-xs opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              <Expand className="size-3" />
              Zoom
            </span>
          </button>

          <p className="mt-3 text-center text-muted-foreground text-xs">
            {activeTabData.description}
          </p>
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