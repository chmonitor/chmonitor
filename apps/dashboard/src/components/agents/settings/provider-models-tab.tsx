'use client'

/**
 * Provider & Models tab — `/agents/settings`.
 *
 * Merges the old separate "Provider" (read-only env-var status) and "Models"
 * (picker) tabs into one provider → model hierarchy: each provider is a
 * group header (lettermark, configured/not-configured status, required env
 * var) with its models listed underneath (context size, max output tokens,
 * per-token pricing, free/default/custom badges), and clicking a model makes
 * it the active model for new conversations — same selection behavior the
 * standalone `AgentModelPicker` already had, just inline instead of behind a
 * popover.
 *
 * Provider/model selection and API keys are fixed at deploy time via
 * environment variables; this tab is status + "which model is active",
 * not an editable provider form.
 */

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  LockKeyholeIcon,
} from 'lucide-react'

import { useClerkIsSignedIn as useClerkIsSignedInImpl } from '../../assistant-ui/use-clerk-is-signed-in'
import { ModelOptionRow, providerDotClass } from '../welcome/agent-model-picker'
import { useMemo } from 'react'
import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { docsSiteUrl } from '@/lib/docs-site'
import {
  type ModelDisplayInfo,
  useAgentModel,
} from '@/lib/hooks/use-agent-model'
import {
  AgentConfigCheckError,
  type AgentConfigCheckProvider,
  useAgentConfigCheck,
} from '@/lib/swr/use-agent-config-check'
import { cn } from '@/lib/utils'

// Same build-time gating pattern as `agent-auth-gate.tsx`: only touch Clerk
// hooks/components when Clerk is actually enabled for this deployment.
const ClerkSignInButton:
  | ((props: { children: React.ReactNode }) => React.ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

const useClerkIsSignedIn: () => boolean = isClerkEnabled()
  ? useClerkIsSignedInImpl
  : () => true

/** Single-letter provider mark — no official logos ship for these providers. */
function ProviderMark({ provider }: { provider: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        providerDotClass(provider)
      )}
    >
      {provider.charAt(0).toUpperCase()}
    </span>
  )
}

function ProviderStatusBadge({
  status,
}: {
  status: AgentConfigCheckProvider | undefined
}) {
  if (!status) return null
  return status.configured ? (
    <Badge
      variant="outline"
      className="h-4 gap-1 px-1.5 text-[10px] font-normal text-[var(--chart-green)]"
    >
      <CheckCircle2Icon className="size-2.5" />
      Configured
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="text-muted-foreground h-4 px-1.5 text-[10px] font-normal"
    >
      Not configured
    </Badge>
  )
}

export function ProviderModelsTab() {
  const { model, models, setModel } = useAgentModel()
  const {
    data: configCheck,
    isLoading: configLoading,
    error: configError,
  } = useAgentConfigCheck()
  const signedIn = useClerkIsSignedIn()

  const configStatusByProvider = useMemo(
    () => new Map(configCheck?.providers.map((p) => [p.id, p]) ?? []),
    [configCheck]
  )

  const grouped = useMemo(() => {
    const map = new Map<string, ModelDisplayInfo[]>()
    for (const m of models) {
      const list = map.get(m.provider) ?? []
      list.push(m)
      map.set(m.provider, list)
    }
    return Array.from(map.entries())
  }, [models])

  // The `agent` feature requires authentication (it runs queries against the
  // cluster) — checking config status hits the same gate. A 401 here just
  // means "not signed in", not a broken deployment; show a calm prompt
  // instead of a destructive error (see agent-auth-gate.tsx for the same
  // framing elsewhere on this page).
  const authRequired =
    configError instanceof AgentConfigCheckError && configError.status === 401
  const genuineError = Boolean(configError) && !authRequired

  return (
    <div className="space-y-4">
      {authRequired && !signedIn && (
        <Alert>
          <LockKeyholeIcon className="size-4" />
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Sign in to view live provider configuration status.</span>
            {ClerkSignInButton && (
              <ClerkSignInButton>
                <Button size="sm" variant="outline" className="h-7 shrink-0">
                  Sign in
                </Button>
              </ClerkSignInButton>
            )}
          </AlertDescription>
        </Alert>
      )}

      {genuineError && (
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertDescription>
            Could not load provider configuration status.
          </AlertDescription>
        </Alert>
      )}

      {configCheck && !configCheck.isFullyConfigured && (
        <Alert variant="destructive">
          <AlertTriangleIcon className="size-4" />
          <AlertDescription>
            No provider is configured. Set{' '}
            <code className="font-mono text-[11px]">
              {configCheck.requiredKeys.apiKey}
            </code>{' '}
            to enable the agent.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {grouped.map(([provider, list]) => {
          const status = configStatusByProvider.get(provider)
          return (
            <div
              key={provider}
              className="divide-border divide-y rounded-md border"
            >
              <div className="bg-muted/40 flex items-center gap-2 px-3 py-2">
                <ProviderMark provider={provider} />
                <span className="text-[11px] font-semibold tracking-wider uppercase">
                  {provider}
                </span>
                {configLoading ? (
                  <Skeleton className="h-4 w-20" />
                ) : (
                  <ProviderStatusBadge status={status} />
                )}
                {status && (
                  <span className="text-muted-foreground ml-auto truncate font-mono text-[10px]">
                    {status.apiKeyEnvVar}
                  </span>
                )}
              </div>
              <div className="space-y-0.5 p-1">
                {list.map((m) => (
                  <ModelOptionRow
                    key={m.id}
                    model={m}
                    active={m.id === model}
                    onSelect={() => setModel(m.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p
        className={cn(
          'text-muted-foreground text-[11px] leading-snug',
          'border-t pt-3'
        )}
      >
        Provider selection and API keys are configured at deploy time via
        environment variables and cannot be changed here. Model choice above is
        saved to this browser; existing conversations keep the model they
        started with. See the{' '}
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
