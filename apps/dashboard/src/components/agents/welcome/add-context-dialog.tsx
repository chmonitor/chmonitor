'use client'

/**
 * "Add context" dialog for the AI Agent composer.
 *
 * Lets the user attach extra context to their next message without typing it
 * inline: a documentation link, a link to a saved/shared query, or a pasted
 * SQL snippet. Added items are owned by the composer (see `WelcomeComposer` in
 * thread.tsx) and prepended to the message as a context block on submit.
 *
 * NOTE: a "pick from query history" tab is intentionally omitted for now — the
 * app has no query-history data source hook yet. Tracked as follow-up.
 */

import { FileTextIcon, LinkIcon, TerminalIcon, XIcon } from 'lucide-react'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export type ContextItemKind = 'docs' | 'query' | 'snippet'

export interface ContextItem {
  id: string
  kind: ContextItemKind
  label: string
  value: string
}

const KIND_META: Record<
  ContextItemKind,
  { icon: typeof LinkIcon; label: string }
> = {
  docs: { icon: FileTextIcon, label: 'Docs' },
  query: { icon: LinkIcon, label: 'Query link' },
  snippet: { icon: TerminalIcon, label: 'Query' },
}

interface AddContextDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ContextItem[]
  onAdd: (item: ContextItem) => void
  onRemove: (id: string) => void
}

export function AddContextDialog({
  open,
  onOpenChange,
  items,
  onAdd,
  onRemove,
}: AddContextDialogProps) {
  const [docsUrl, setDocsUrl] = useState('')
  const [queryUrl, setQueryUrl] = useState('')
  const [snippet, setSnippet] = useState('')

  // IDs are derived from a monotonic counter so this stays deterministic for
  // tests (no Math.random / Date.now in the render path).
  const [seq, setSeq] = useState(0)
  const nextId = () => {
    const id = `ctx-${seq}`
    setSeq((n) => n + 1)
    return id
  }

  const add = (kind: ContextItemKind, value: string, label: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    onAdd({ id: nextId(), kind, value: trimmed, label })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add context</DialogTitle>
          <DialogDescription>
            Attach a doc, a query link, or a SQL snippet to your next message.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="docs">
          <TabsList className="w-full">
            <TabsTrigger value="docs" className="flex-1 text-[12px]">
              Docs link
            </TabsTrigger>
            <TabsTrigger value="query" className="flex-1 text-[12px]">
              Query link
            </TabsTrigger>
            <TabsTrigger value="snippet" className="flex-1 text-[12px]">
              Paste query
            </TabsTrigger>
          </TabsList>

          <TabsContent value="docs" className="space-y-2">
            <Input
              value={docsUrl}
              onChange={(e) => setDocsUrl(e.target.value)}
              placeholder="https://clickhouse.com/docs/…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  add('docs', docsUrl, docsUrl.trim())
                  setDocsUrl('')
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={!docsUrl.trim()}
              onClick={() => {
                add('docs', docsUrl, docsUrl.trim())
                setDocsUrl('')
              }}
            >
              Add docs link
            </Button>
          </TabsContent>

          <TabsContent value="query" className="space-y-2">
            <Input
              value={queryUrl}
              onChange={(e) => setQueryUrl(e.target.value)}
              placeholder="Link to a saved or shared query"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  add('query', queryUrl, queryUrl.trim())
                  setQueryUrl('')
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={!queryUrl.trim()}
              onClick={() => {
                add('query', queryUrl, queryUrl.trim())
                setQueryUrl('')
              }}
            >
              Add query link
            </Button>
          </TabsContent>

          <TabsContent value="snippet" className="space-y-2">
            <Textarea
              value={snippet}
              onChange={(e) => setSnippet(e.target.value)}
              placeholder="SELECT … FROM system.query_log …"
              className="min-h-24 font-mono text-[12px]"
            />
            <Button
              type="button"
              size="sm"
              disabled={!snippet.trim()}
              onClick={() => {
                const label =
                  snippet.trim().slice(0, 40) +
                  (snippet.trim().length > 40 ? '…' : '')
                add('snippet', snippet, label)
                setSnippet('')
              }}
            >
              Add query
            </Button>
          </TabsContent>
        </Tabs>

        {items.length > 0 ? (
          <div className="border-t pt-3">
            <div className="text-muted-foreground mb-2 text-[10.5px] max-sm:text-xs font-semibold tracking-wider uppercase">
              Attached ({items.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((item) => {
                const Icon = KIND_META[item.kind].icon
                return (
                  <span
                    key={item.id}
                    className="bg-muted flex max-w-full items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-[11.5px] max-sm:text-xs"
                  >
                    <Icon className="text-muted-foreground size-3 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      className="text-muted-foreground hover:text-foreground hover:bg-background rounded p-0.5"
                      aria-label={`Remove ${item.label}`}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Format attached context items into a markdown block prepended to the user's
 * message so the agent sees the references.
 */
export function formatContextBlock(items: ContextItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map((item) => {
    if (item.kind === 'snippet') {
      return `- ${KIND_META[item.kind].label}:\n\`\`\`sql\n${item.value}\n\`\`\``
    }
    return `- ${KIND_META[item.kind].label}: ${item.value}`
  })
  return `Context:\n${lines.join('\n')}`
}
