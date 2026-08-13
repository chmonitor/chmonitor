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
      className="group w-full flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm truncate">{prompt}</span>
      </div>
      <span className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
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
