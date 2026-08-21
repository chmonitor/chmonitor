'use client'

/**
 * Model picker for the AI Agent page.
 *
 * Renders the active model with a provider-colored dot, the provider name
 * (anyrouter / openrouter / nvidia / …), the model id and a "default" /
 * "free" badge. Clicking opens a popover grouped by provider so users can
 * jump between OpenRouter, AnyRouter, NVIDIA-hosted variants, etc.
 *
 * Sits on the welcome screen toolbar AND the right-hand Agent settings
 * sidebar; both consume `useAgentModel`.
 */

import { CheckIcon, ChevronDownIcon, ClockIcon, SearchIcon } from 'lucide-react'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getAllModelOptions } from '@/lib/ai/agent-model-registry'
import {
  type ModelDisplayInfo,
  useAgentModel,
} from '@/lib/hooks/use-agent-model'
import { useAnyRouterToken } from '@/lib/hooks/use-anyrouter-token'
import { cn } from '@/lib/utils'

/** Set of model IDs that are part of the curated static registry. */
export const CURATED_MODEL_IDS = new Set(getAllModelOptions())

interface AgentModelPickerProps {
  /** Compact toolbar variant (welcome screen toolbar). */
  variant?: 'toolbar' | 'panel'
  className?: string
}

const PROVIDER_DOT_CLASS: Record<string, string> = {
  openrouter: 'bg-[var(--chart-blue)]',
  anyrouter: 'bg-[var(--chart-1)]',
  nvidia: 'bg-[var(--chart-green)]',
}

export function providerDotClass(provider: string): string {
  return PROVIDER_DOT_CLASS[provider] ?? 'bg-muted-foreground'
}

function badgeTone(model: ModelDisplayInfo): {
  label: string
  className: string
} | null {
  if (model.isFree) {
    return {
      label: 'free',
      className: 'bg-[var(--chart-green)]/10 text-[var(--chart-green)]',
    }
  }
  if (model.modelId.endsWith('/free') || model.modelId.endsWith('/auto')) {
    return {
      label: 'default',
      className: 'bg-[var(--chart-blue)]/10 text-[var(--chart-blue)]',
    }
  }
  return null
}

/** `262.1K ctx · 8.2K out · $0.35/M in · $0.40/M out`, omitting unknown parts. */
function modelMetaLine(model: ModelDisplayInfo): string {
  const parts = [`${model.formattedContextLength} ctx`]
  if (model.formattedMaxOutputTokens) {
    parts.push(`${model.formattedMaxOutputTokens} out`)
  }
  if (model.pricing) {
    parts.push(`$${model.pricing.inputPerMillion.toFixed(2)}/M in`)
    parts.push(`$${model.pricing.outputPerMillion.toFixed(2)}/M out`)
  } else if (model.isFree) {
    parts.push('free')
  }
  return parts.join(' · ')
}

/**
 * One selectable model row: name, metadata line (context / max output /
 * pricing), free-or-default and custom badges, and a check when active.
 * Shared by the popover list here and the persistent list in the merged
 * Provider & Models settings tab.
 */
export function ModelOptionRow({
  model,
  active,
  onSelect,
}: {
  model: ModelDisplayInfo
  active: boolean
  onSelect: () => void
}) {
  const tone = badgeTone(model)
  const isCustom = !CURATED_MODEL_IDS.has(model.id)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
        active && 'bg-muted/60'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px]">
          <span className="text-foreground">{model.name}</span>
        </div>
        <div className="text-muted-foreground truncate text-[10px] tabular-nums">
          <span className="font-mono">
            {model.provider}:{model.modelId}
          </span>
          {' · '}
          {modelMetaLine(model)}
        </div>
      </div>
      {tone ? (
        <Badge
          variant="secondary"
          className={cn(
            'h-4 shrink-0 px-1.5 text-[10px] font-normal',
            tone.className
          )}
        >
          {tone.label}
        </Badge>
      ) : null}
      {isCustom ? (
        <Badge
          variant="secondary"
          className="h-4 shrink-0 px-1.5 text-[10px] font-normal opacity-60"
        >
          custom
        </Badge>
      ) : null}
      {active ? (
        <CheckIcon className="size-3 shrink-0 text-[var(--chart-green)]" />
      ) : null}
    </button>
  )
}

export function AgentModelPicker({
  variant = 'toolbar',
  className,
}: AgentModelPickerProps) {
  const {
    model,
    models,
    setModel,
    recentModelIds,
    addCustomModel,
    noProvidersConfigured,
    modelsLoaded,
    configuredProviders,
  } = useAgentModel()
  const anyRouter = useAnyRouterToken()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [customInput, setCustomInput] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)

  const selected = useMemo(
    () => models.find((m) => m.id === model) ?? models[0],
    [model, models]
  )

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) =>
      `${m.provider}:${m.name}`.toLowerCase().includes(q)
    )
  }, [models, search])

  /** Recently used models, pinned above the provider groups. */
  const recent = useMemo(() => {
    const byId = new Map(matches.map((m) => [m.id, m]))
    return recentModelIds
      .map((id) => byId.get(id))
      .filter((m): m is ModelDisplayInfo => m !== undefined)
  }, [matches, recentModelIds])

  const grouped = useMemo(() => {
    const map = new Map<string, ModelDisplayInfo[]>()
    for (const m of matches) {
      const list = map.get(m.provider) ?? []
      list.push(m)
      map.set(m.provider, list)
    }
    return Array.from(map.entries())
  }, [matches])

  /**
   * Offer sign-in only when AnyRouter has no deploy-time key. With
   * `ANYROUTER_API_KEY` set the provider already works for everyone, so the
   * flow would only redirect billing and add a way to get it wrong.
   *
   * Requires a non-empty `configuredProviders`: it comes back empty whenever
   * the models fetch fails, and treating that as "no AnyRouter key" would
   * offer sign-in on a properly configured deployment during an upstream blip.
   */
  const showAnyRouterSignIn =
    modelsLoaded &&
    (anyRouter.isSignedIn ||
      (configuredProviders.length > 0 &&
        !configuredProviders.includes('anyrouter')))

  const submitCustomModel = () => {
    const error = addCustomModel(customInput)
    if (error) {
      setCustomError(error)
      return
    }
    setCustomError(null)
    setCustomInput('')
    setOpen(false)
  }

  if (modelsLoaded && noProvidersConfigured && !anyRouter.isSignedIn) {
    return (
      <div
        className={cn(
          'text-muted-foreground border-input flex min-h-10 w-full flex-col items-start gap-1 rounded-md border border-dashed px-3 py-2 text-[11px] leading-snug',
          variant === 'toolbar' && 'h-6 min-h-0 flex-row border-0 px-2 py-0',
          className
        )}
      >
        <span>
          No LLM provider configured — set OPENROUTER_API_KEY,
          ANYROUTER_API_KEY, or NVIDIA_API_KEY
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-[11px]"
          disabled={anyRouter.isSigningIn}
          onClick={anyRouter.signIn}
        >
          {anyRouter.isSigningIn ? 'Signing in…' : 'or sign in with AnyRouter'}
        </Button>
      </div>
    )
  }

  if (!selected) {
    return null
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger
        render={
          variant === 'toolbar' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'text-muted-foreground hover:text-foreground h-6 gap-1.5 px-2 text-[11.5px]',
                className
              )}
            >
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  providerDotClass(selected.provider)
                )}
              />
              <span className="truncate">
                <span className="text-foreground">{selected.name}</span>
                <span className="text-muted-foreground">
                  {' '}
                  <span className="font-mono">
                    {selected.provider}:{selected.modelId}
                  </span>
                </span>
              </span>
            </Button>
          ) : (
            <button
              type="button"
              className={cn(
                'bg-background border-input hover:bg-muted/40 flex h-auto min-h-10 w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left transition-colors',
                className
              )}
            >
              <span
                className={cn(
                  'inline-block size-1.5 shrink-0 rounded-full',
                  providerDotClass(selected.provider)
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px]">
                  <span className="text-foreground">{selected.name}</span>
                </div>
                <div className="text-muted-foreground truncate text-[10px] tabular-nums">
                  <span className="font-mono">
                    {selected.provider}:{selected.modelId}
                  </span>
                  {' · '}
                  {selected.formattedContextLength} ctx
                  {selected.pricing
                    ? ` · $${selected.pricing.inputPerMillion.toFixed(2)}/M in`
                    : selected.isFree
                      ? ' · free'
                      : ''}
                </div>
              </div>
              {(() => {
                const tone = badgeTone(selected)
                if (!tone) return null
                return (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'h-4 shrink-0 px-1.5 text-[10px] font-normal',
                      tone.className
                    )}
                  >
                    {tone.label}
                  </Badge>
                )
              })()}
              <ChevronDownIcon className="text-muted-foreground size-3 shrink-0 opacity-60" />
            </button>
          )
        }
      />
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[340px] gap-0 p-1"
      >
        <div className="relative p-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models…"
            className="h-8 pl-7 text-[12px]"
          />
        </div>
        <div className="max-h-[360px] space-y-1 overflow-y-auto overscroll-contain">
          {grouped.length === 0 ? (
            <div className="text-muted-foreground px-2 py-6 text-center text-[12px]">
              No models match “{search}” — enter a model id below to use it
              anyway
            </div>
          ) : null}
          {recent.length > 0 ? (
            <div className="space-y-0.5">
              <div className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">
                <ClockIcon className="size-2.5" />
                recent
              </div>
              {recent.map((m) => (
                <ModelOptionRow
                  key={`recent-${m.id}`}
                  model={m}
                  active={m.id === model}
                  onSelect={() => {
                    setModel(m.id)
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          ) : null}
          {grouped.map(([provider, list]) => (
            <div key={provider} className="space-y-0.5">
              <div className="text-muted-foreground flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">
                <span
                  className={cn(
                    'inline-block size-1.5 rounded-full',
                    providerDotClass(provider)
                  )}
                />
                {provider}
              </div>
              {list.map((m) => (
                <ModelOptionRow
                  key={m.id}
                  model={m}
                  active={m.id === model}
                  onSelect={() => {
                    setModel(m.id)
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="border-t p-1 pt-1.5">
          <div className="flex items-center gap-1">
            <Input
              value={customInput}
              onChange={(e) => {
                setCustomInput(e.target.value)
                setCustomError(null)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                submitCustomModel()
              }}
              placeholder="provider:model — use any model id"
              aria-label="Custom model id"
              aria-invalid={customError !== null}
              className="h-8 font-mono text-[11.5px]"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 shrink-0 px-2 text-[11.5px]"
              disabled={customInput.trim().length === 0}
              onClick={submitCustomModel}
            >
              Use
            </Button>
          </div>
          {customError ? (
            <p className="text-destructive px-1 pt-1 text-[10.5px]">
              {customError}
            </p>
          ) : null}

          {showAnyRouterSignIn ? (
            <div className="flex items-center justify-between gap-2 px-1 pt-1.5">
              <span className="text-muted-foreground text-[10.5px]">
                {anyRouter.isSignedIn
                  ? 'Using your AnyRouter credits'
                  : 'No AnyRouter key on this deployment'}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-[10.5px]"
                disabled={anyRouter.isSigningIn}
                onClick={
                  anyRouter.isSignedIn ? anyRouter.signOut : anyRouter.signIn
                }
              >
                {anyRouter.isSigningIn
                  ? 'Signing in…'
                  : anyRouter.isSignedIn
                    ? 'Sign out'
                    : 'Sign in with AnyRouter'}
              </Button>
            </div>
          ) : null}
          {anyRouter.error ? (
            <p className="text-destructive px-1 pt-1 text-[10.5px]">
              {anyRouter.error}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
