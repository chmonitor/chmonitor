'use client'

import { X } from 'lucide-react'

import type { Mention, SlashCommand } from './types'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface MentionBadgeProps {
  mention: Mention
  onRemove: (id: string) => void
}

const TYPE_CLASSES: Record<Mention['type'], string> = {
  table:
    'border-transparent bg-[var(--chart-blue)]/15 text-[var(--chart-blue)] hover:bg-[var(--chart-blue)]/25',
  resource:
    'border-transparent bg-[var(--chart-green)]/15 text-[var(--chart-green)] hover:bg-[var(--chart-green)]/25',
  skill:
    'border-transparent bg-[var(--chart-1)]/15 text-[var(--chart-1)] hover:bg-[var(--chart-1)]/25',
}

export function MentionBadge({ mention, onRemove }: MentionBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex items-center gap-1 py-0.5 pl-2 pr-1 text-xs font-medium',
        TYPE_CLASSES[mention.type]
      )}
    >
      <span>@{mention.label}</span>
      <button
        type="button"
        aria-label={`Remove ${mention.label} mention`}
        onClick={() => onRemove(mention.id)}
        className="ml-0.5 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}

interface SlashCommandBadgeProps {
  command: SlashCommand
  onRemove: () => void
}

export function SlashCommandBadge({
  command,
  onRemove,
}: SlashCommandBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex items-center gap-1 py-0.5 pl-2 pr-1 text-xs font-medium',
        'border-transparent bg-[var(--chart-3)]/15 text-[var(--chart-3)] hover:bg-[var(--chart-3)]/25'
      )}
    >
      <span>{command.label}</span>
      <button
        type="button"
        aria-label={`Remove ${command.label} command`}
        onClick={onRemove}
        className="ml-0.5 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}
