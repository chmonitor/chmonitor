'use client'

/**
 * Provider tab — `/agents/settings`.
 *
 * Read-only status of the LLM provider(s) the agent can call. The active
 * provider/model and API keys are configured at deploy time via environment
 * variables (`LLM_MODEL`, `OPENROUTER_API_KEY`, `ANYROUTER_API_KEY`, …), so
 * this surfaces `GET /api/v1/agents/config-check` rather than an editable
 * form — same "fixed at deploy time" framing as the Conversation History
 * panel in the chat sidebar.
 */

import { CheckCircle2Icon, XCircleIcon } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { docsSiteUrl } from '@/lib/docs-site'
import { useAgentConfigCheck } from '@/lib/swr/use-agent-config-check'
import { cn } from '@/lib/utils'

export function ProviderTab() {
  const { data, isLoading, error } = useAgentConfigCheck()

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load provider configuration status.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {!data.isFullyConfigured && (
        <Alert variant="destructive">
          <AlertDescription>
            No provider is configured. Set{' '}
            <code className="font-mono text-[11px]">
              {data.requiredKeys.apiKey}
            </code>{' '}
            to enable the agent.
          </AlertDescription>
        </Alert>
      )}

      <div className="divide-border divide-y rounded-md border">
        {data.providers.map((provider) => (
          <div
            key={provider.id}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">{provider.name}</span>
                {provider.configured ? (
                  <Badge
                    variant="outline"
                    className="h-4 gap-1 px-1.5 text-[10px] font-normal text-emerald-700 dark:text-emerald-400"
                  >
                    <CheckCircle2Icon className="size-2.5" />
                    Configured
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground h-4 gap-1 px-1.5 text-[10px] font-normal"
                  >
                    <XCircleIcon className="size-2.5" />
                    Not configured
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-0.5 font-mono text-[10.5px]">
                {provider.apiKeyEnvVar}
                {provider.hasBaseURLOverride
                  ? ' · custom base URL'
                  : ` · ${provider.baseURL}`}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p
        className={cn(
          'text-muted-foreground text-[11px] leading-snug',
          'border-t pt-3'
        )}
      >
        Provider selection and API keys are configured at deploy time via
        environment variables and cannot be changed here. See the{' '}
        <a
          href={docsSiteUrl('guide/ai-agent')}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-2"
        >
          AI Agent docs
        </a>{' '}
        for the full list of supported providers.
      </p>
    </div>
  )
}
