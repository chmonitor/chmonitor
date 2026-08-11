import { ChevronDown, ChevronRight, ShieldCheck, Wrench } from 'lucide-react'

import { CodeBlock } from './copy-button'
import { MCP_TOOLS } from '@chm/mcp-server/data'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function ParamBadge({ required }: { required: boolean }) {
  return (
    <Badge
      variant={required ? 'default' : 'secondary'}
      className="text-[10px] px-1.5 py-0"
    >
      {required ? 'required' : 'optional'}
    </Badge>
  )
}

function ToolCard({ tool }: { tool: (typeof MCP_TOOLS)[number] }) {
  const [expanded, setExpanded] = useState(false)
  const requiredCount = tool.params.filter((param) => param.required).length

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
          <Wrench className="size-4" />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-sm font-semibold text-primary">
              {tool.name}
            </code>
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-normal"
            >
              {tool.category}
            </Badge>
          </span>
          {/* Description reads on every breakpoint — it is the row's content,
              not decoration. */}
          <span className="block truncate text-xs text-muted-foreground">
            {tool.description}
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {tool.params.length} arg{tool.params.length !== 1 ? 's' : ''}
            {requiredCount > 0 ? ` · ${requiredCount} required` : ''}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 px-1.5 py-0 text-[10px] font-normal"
          >
            <ShieldCheck className="size-3" />
            read-only
          </Badge>
        </span>
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-4 bg-muted/20">
          {/* Parameters */}
          <div className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parameters
            </h5>
            <div className="space-y-2">
              {tool.params.map((param) => (
                <div
                  key={param.name}
                  className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 text-xs rounded-md bg-background border px-3 py-2"
                >
                  <div className="flex items-center gap-2 shrink-0">
                    <code className="font-semibold">{param.name}</code>
                    <span className="text-muted-foreground">{param.type}</span>
                    <ParamBadge required={param.required} />
                  </div>
                  <div className="text-muted-foreground flex-1">
                    {param.description}
                    {param.default !== undefined && (
                      <span className="ml-1">
                        Default:{' '}
                        <code className="text-foreground">
                          {String(param.default)}
                        </code>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Example Response */}
          <div className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Example Response
            </h5>
            <CodeBlock>{tool.exampleResponse}</CodeBlock>
          </div>
        </div>
      )}
    </div>
  )
}

export function McpToolsDocs() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Available Tools ({MCP_TOOLS.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {MCP_TOOLS.map((tool) => (
          <ToolCard key={tool.name} tool={tool} />
        ))}
      </CardContent>
    </Card>
  )
}
