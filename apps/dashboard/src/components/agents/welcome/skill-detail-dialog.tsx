'use client'

/**
 * Detail dialog for a single skill. Opens when the user clicks a skill row in
 * the composer toolbar's skills popover (or the sidebar) and shows the skill's
 * description, source, included tools, and longer-form details.
 */

import { CheckIcon } from 'lucide-react'

import type { Skill } from '@/components/agents/welcome/skills-data'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface SkillDetailDialogProps {
  skill: Skill | null
  open: boolean
  onOpenChange: (open: boolean) => void
  isEnabled?: boolean
  onToggle?: (id: string) => void
}

export function SkillDetailDialog({
  skill,
  open,
  onOpenChange,
  isEnabled,
  onToggle,
}: SkillDetailDialogProps) {
  if (!skill) return null
  const Icon = skill.icon
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="border-b bg-muted/30 px-5 py-4 text-left">
          <div className="flex items-start gap-3">
            <div className="bg-background border-border inline-flex size-10 shrink-0 items-center justify-center rounded-xl border">
              <Icon className="text-foreground size-4" strokeWidth={1.6} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                <span className="truncate">{skill.name}</span>
                <Badge
                  variant={skill.source === 'system' ? 'default' : 'outline'}
                  className={cn(
                    'h-4 px-1.5 text-[10px] font-normal',
                    skill.source === 'system'
                      ? 'bg-[var(--chart-blue)]/10 text-[var(--chart-blue)]'
                      : 'text-muted-foreground'
                  )}
                >
                  {skill.source}
                </Badge>
                {isEnabled ? (
                  <Badge
                    variant="secondary"
                    className="h-4 gap-1 px-1.5 text-[10px] font-normal bg-[var(--chart-green)]/10 text-[var(--chart-green)]"
                  >
                    <CheckIcon className="size-2.5" /> active
                  </Badge>
                ) : null}
              </DialogTitle>
              <DialogDescription className="text-left text-[12.5px] leading-snug">
                {skill.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 p-5">
            {skill.details ? (
              <p className="text-muted-foreground text-[13px] leading-6">
                {skill.details}
              </p>
            ) : null}

            <div>
              <div className="text-muted-foreground mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
                Tools included ({skill.tools.length})
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {skill.tools.map((tool) => (
                  <div
                    key={tool}
                    className="border-border bg-card flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                  >
                    <span className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--chart-green)]" />
                    <span className="truncate font-mono text-[11.5px]">
                      {tool}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {onToggle ? (
              <div className="border-border flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[12px]">
                  <div className="font-medium">
                    {isEnabled ? 'Skill enabled' : 'Skill disabled'}
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {isEnabled
                      ? 'Its tools are available to the agent.'
                      : 'Tools from this skill are hidden from the agent.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggle(skill.id)}
                  className={cn(
                    'h-7 shrink-0 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors',
                    isEnabled
                      ? 'border-border bg-background hover:bg-muted'
                      : 'border-foreground bg-foreground text-background hover:bg-foreground/90'
                  )}
                >
                  {isEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
