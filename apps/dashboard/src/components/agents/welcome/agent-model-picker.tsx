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

import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'

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
import { cn } from '@/lib/utils'

/** Set of model IDs that are part of the curated static registry. */
export const CURATED_MODEL_IDS = new Set(getAllModelOptions())

interface AgentModelPickerProps {
  /** Compact toolbar variant (welcome screen toolbar). */
  variant?: 'toolbar' | 'panel'
  className?: string
}

const PROVIDER_TEXT_CLASS: Record<string, string> = {
  openrouter: 'text-blue-600 dark:text-blue-400',
  anyrouter: 'text-violet-600 dark:text-violet-400',
  nvidia: 'text-emerald-600 dark:text-emerald-400',
}

const PROVIDER_DOT_CLASS: Record<string, string> = {
  openrouter: 'bg-blue-500',
  anyrouter: 'bg-violet-500',
  nvidia: 'bg-emerald-500',
}

export function providerColorClass(provider: string): string {
  return PROVIDER_TEXT_CLASS[provider] ?? 'text-muted-foreground'
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
      className:
        'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    }
  }
  if (model.modelId.endsWith('/free') || model.modelId.endsWith('/auto')) {
    return {
      label: 'default',
      className:
        'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
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
        <div className="truncate font-mono text-[12px]">
          <span className={providerColorClass(model.provider)}>
            {model.provider}
          </span>
          <span className="text-muted-foreground">:</span>
          <span className="text-foreground">{model.name}</span>
        </div>
        <div className="text-muted-foreground truncate text-[10px] tabular-nums">
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
        <CheckIcon className="size-3 shrink-0 text-emerald-500" />
      ) : null}
    </button>
  )
}

export function AgentModelPicker({
  variant = 'toolbar',
  className,
}: AgentModelPickerProps) {
  const { model, models, setModel } = useAgentModel()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = useMemo(
    () => models.find((m) => m.id === model) ?? models[0],
    [model, models]
  )

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const map = new Map<string, ModelDisplayInfo[]>()
    for (const m of models) {
      if (q && !`${m.provider}:${m.name}`.toLowerCase().includes(q)) continue
      const list = map.get(m.provider) ?? []
      list.push(m)
      map.set(m.provider, list)
    }
    return Array.from(map.entries())
  }, [models, search])

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
                'text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-[11.5px]',
                className
              )}
            >
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  providerDotClass(selected.provider)
                )}
              />
              <span className="font-mono">
                <span className={providerColorClass(selected.provider)}>
                  {selected.provider}
                </span>
                <span className="text-muted-foreground">:</span>
                <span className="text-foreground">{selected.name}</span>
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
                <div className="truncate font-mono text-[12px]">
                  <span className={providerColorClass(selected.provider)}>
                    {selected.provider}
                  </span>
                  <span className="text-muted-foreground">:</span>
                  <span className="text-foreground">{selected.name}</span>
                </div>
                <div className="text-muted-foreground text-[10px] tabular-nums">
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
              No models match “{search}”
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
      </PopoverContent>
    </Popover>
  )
}
