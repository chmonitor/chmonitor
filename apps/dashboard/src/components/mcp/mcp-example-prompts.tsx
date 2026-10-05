import { Check, Copy, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'

import { EXAMPLE_PROMPTS } from '@chm/mcp-server/data'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { copyToClipboard } from '@/lib/utils/clipboard'

function PromptItem({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const success = await copyToClipboard(prompt)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Failed to copy prompt')
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      // WCAG 2.5.3 Label in Name: the visible text of this row is the prompt
      // itself, so the accessible name has to contain it. "Copy prompt" alone
      // meant a voice user saying the prompt text could not hit this button.
      // Kept in both states because only the icon swaps when copied.
      aria-label={
        copied ? `Copied prompt: ${prompt}` : `Copy prompt: ${prompt}`
      }
      className="group w-full flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm truncate">{prompt}</span>
      </div>
      {/* Copy affordance hint on an already-visible, already-named button.
          Hover does not exist on touch and Tailwind v4 wraps a bare `hover:` in
          `@media (hover: hover)`, so the resting `opacity-0` meant the icon
          never showed for anyone on a coarse pointer. Rest at 40%, hide only
          where a hover does — the contract
          components/cards/chart-action-classes.ts already ships. */}
      <span
        aria-hidden
        className="shrink-0 text-muted-foreground opacity-40 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-40 pointer-fine:group-focus-within:opacity-40 group-hover:!opacity-100 group-focus-within:!opacity-100"
      >
        {copied ? (
          <Check className="size-3.5 text-green-600" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </span>
    </button>
  )
}

export function McpExamplePrompts() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Example Prompts</CardTitle>
        <CardDescription className="text-xs">
          Click any prompt to copy it. Paste into Claude, Cursor, or any
          MCP-compatible AI assistant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {EXAMPLE_PROMPTS.map((group) => (
          <div key={group.category} className="space-y-2">
            <Badge variant="outline" className="text-xs">
              {group.category}
            </Badge>
            <div className="space-y-1.5">
              {group.prompts.map((prompt) => (
                <PromptItem key={prompt} prompt={prompt} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
