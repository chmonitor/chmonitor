/**
 * Stream orchestration for POST /api/v1/agent: timeout budgets, usage/cost
 * accounting, error classification into stream data parts, quota release and
 * MCP teardown.
 *
 * Extracted from `handlePost` in issue #2885 — the UI message stream protocol,
 * the data-part shapes (`data-usage` / `data-error`) and the response headers
 * are unchanged.
 */

import type { LanguageModelUsage } from 'ai'
import type { Plan } from '@/lib/billing/plans'
import type { AgentRuntime, AgentUiMessage } from './runtime'

import { AGENT_DEBUG_LOGS } from './debug'
import { pipeJsonRender } from '@json-render/core'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIDataTypes,
  type UIMessage,
  type UITools,
} from 'ai'
import { aggregateUsageWithCost } from '@/lib/ai/agent/analytics'
import {
  classifyError,
  formatAgentErrorText,
  sanitizeAgentError,
} from '@/lib/ai/agent/errors'
import { createJsonRenderPatchGuardStream } from '@/lib/ai/agent/json-render-patch-guard'
import { meterAiOverage } from '@/lib/billing/ai-usage-store'

/**
 * Secrets that must never be echoed back to the client inside an error
 * message: the deployment's own provider/DB credentials plus this request's
 * BYOK key (if any). An upstream provider error, or a tool failure touching
 * ClickHouse, can otherwise echo a credential verbatim in its message. Exact
 * values only — shape-based redaction (URL userinfo, `Bearer …`, `sk-…`, …)
 * is handled separately by `redactSecrets`.
 */
function collectSecretsToRedact(
  byokApiKey: string | null
): (string | null | undefined)[] {
  return [
    byokApiKey,
    process.env.OPENROUTER_API_KEY,
    process.env.ANYROUTER_API_KEY,
    process.env.NVIDIA_API_KEY,
    process.env.LLM_API_KEY,
    process.env.CLICKHOUSE_PASSWORD,
    process.env.AGENTSTATE_API_KEY,
  ]
}

// Free / routed providers can take 20-40s between a tool call and the
// follow-up summary. The previous 12s step/chunk budget killed the loop
// after the first tool call on slower models. Give it real room and let
// stepCountIs(maxSteps) remain the actual termination guard.
export const AGENT_STREAM_TIMEOUT_MS = 120_000
export const AGENT_STREAM_STEP_TIMEOUT_MS = 45_000

export function createAgentStreamResponse(options: {
  agent: AgentRuntime['agent']
  mcpCloseAll: (() => Promise<void>) | null
  uiMessages: AgentUiMessage[]
  userMessage: string | undefined
  model: string
  requestedProvider: string
  billingOwnerId: string | null
  resolvedPlan: Plan | null
  releaseReservationOnce: () => Promise<void>
  /** BYOK key for this request, if any — redacted from any error text that
   * reaches the client (see `collectSecretsToRedact`). */
  byokApiKey?: string | null
}): Response {
  const {
    agent,
    mcpCloseAll,
    uiMessages,
    userMessage,
    model,
    requestedProvider,
    billingOwnerId,
    resolvedPlan,
    releaseReservationOnce,
    byokApiKey = null,
  } = options

  const usageSteps: LanguageModelUsage[] = []
  // Tracks the provider-reported model ID from the last completed step.
  // Populated synchronously in onStepEnd so it is available after consumeStream().
  let lastStepModelId: string | undefined

  const secretsToRedact = collectSecretsToRedact(byokApiKey)
  // Formats an unknown thrown/streamed error into a client-safe display
  // string (classified message + suggestion, secrets stripped) — used
  // wherever the AI SDK asks for `errorText: string` rather than a
  // structured AgentError, so those chunks never fall back to the SDK's
  // masked "An error occurred." default.
  const formatErrorText = (error: unknown) =>
    formatAgentErrorText(
      error,
      { model, provider: requestedProvider },
      secretsToRedact
    )

  const buildStats = (resolvedModel: string) => ({
    ...aggregateUsageWithCost(usageSteps, model),
    model,
    provider: requestedProvider,
    resolvedModel,
  })

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let modelMessages: ModelMessage[] = []

      try {
        modelMessages = await convertToModelMessages(
          uiMessages as Array<
            Omit<UIMessage<unknown, UIDataTypes, UITools>, 'id'>
          >,
          {
            ignoreIncompleteToolCalls: true,
          }
        )
      } catch (_error) {
        modelMessages = [
          {
            role: 'user',
            content:
              typeof userMessage === 'string'
                ? userMessage
                : 'Request context unavailable.',
          },
        ] as ModelMessage[]
      }

      try {
        const result = await agent.stream({
          messages: modelMessages,
          onStepEnd: (step) => {
            usageSteps.push(step.usage)
            // Capture the provider-reported model ID (e.g., the resolved model
            // behind an auto-router preset). Falls back gracefully if absent.
            if (step.response?.modelId) {
              lastStepModelId = step.response.modelId
            }

            const { inputTokenDetails } = step.usage
            if (
              inputTokenDetails &&
              (inputTokenDetails.cacheReadTokens ||
                inputTokenDetails.cacheWriteTokens)
            ) {
              if (AGENT_DEBUG_LOGS) {
                console.log('[Agent API] Cache token stats:', {
                  cacheReadTokens: inputTokenDetails.cacheReadTokens,
                  cacheWriteTokens: inputTokenDetails.cacheWriteTokens,
                  inputTokens: step.usage.inputTokens,
                  outputTokens: step.usage.outputTokens,
                })
              }
            }
          },
          timeout: {
            totalMs: AGENT_STREAM_TIMEOUT_MS,
            stepMs: AGENT_STREAM_STEP_TIMEOUT_MS,
            chunkMs: AGENT_STREAM_STEP_TIMEOUT_MS,
          },
        })

        writer.merge(
          createJsonRenderPatchGuardStream(
            pipeJsonRender(
              // `onError` formats `error` / `tool-error` chunk `errorText`
              // (e.g. a dynamicTool's `execute` throwing) — without it the AI
              // SDK falls back to its safe-by-default "An error occurred.",
              // which hides the real cause from both the user and the
              // agent's own self-correction loop.
              result.toUIMessageStream({ onError: formatErrorText })
            )
          )
        )
        await result.consumeStream()

        // After stream consumption, attempt to get the final response modelId.
        // result.response is a PromiseLike that resolves once the stream is done.
        let resolvedModel: string | undefined = lastStepModelId
        if (!resolvedModel) {
          try {
            const responseMetadata = await result.response
            if (responseMetadata.modelId) {
              resolvedModel = responseMetadata.modelId
            }
          } catch {
            // response metadata unavailable — fall back to requested model
          }
        }
        resolvedModel = resolvedModel || model

        // Send aggregated usage/cost as a data part so the client can display it
        if (usageSteps.length > 0) {
          const stats = buildStats(resolvedModel)
          writer.write({
            type: 'data-usage',
            data: [stats],
          })

          // Meter the actual spend as overage now that the generation
          // succeeded (cloud only; Free/Enterprise never accrue overage — see
          // meterAiOverage; no-op when D1/owner/plan absent).
          if (billingOwnerId && resolvedPlan && stats.estimatedCostUsd) {
            await meterAiOverage(
              resolvedPlan,
              billingOwnerId,
              stats.estimatedCostUsd
            )
          }
        }
      } catch (error) {
        const classified = sanitizeAgentError(
          classifyError(error, { model, provider: requestedProvider }),
          secretsToRedact
        )
        console.error('[Agent API] Classified error:', classified)
        writer.write({
          type: 'data-error',
          data: [classified],
        })
        if (usageSteps.length > 0) {
          const stats = buildStats(lastStepModelId || model)
          writer.write({
            type: 'data-usage',
            data: [stats],
          })
          // Generation started and incurred cost before failing — still meter
          // what was actually spent as overage.
          if (billingOwnerId && resolvedPlan && stats.estimatedCostUsd) {
            await meterAiOverage(
              resolvedPlan,
              billingOwnerId,
              stats.estimatedCostUsd
            )
          }
        } else {
          // Generation failed before producing any output — release the daily
          // reservation so aborted requests don't consume the user's quota.
          await releaseReservationOnce()
        }
      }
    },
    onError: (error) => {
      const classified = sanitizeAgentError(
        classifyError(error, { model, provider: requestedProvider }),
        secretsToRedact
      )
      console.error('[Agent API] Classified error:', classified)
      // A failure can surface here (rather than the inner execute catch) when it
      // is thrown inside the merged/piped stream after the reservation. If no
      // output was produced, release the daily reservation so the user is not
      // charged for a request that yielded nothing. Best-effort + idempotent:
      // releaseReservationOnce guards against a double release if the inner
      // catch already released.
      if (usageSteps.length === 0) {
        void releaseReservationOnce()
      }
      // Plain, redacted, human-readable text — matches `formatErrorText`
      // above and how the client renders an `errorText` field (raw text, not
      // JSON) for both the top-level `error` chunk and per-tool
      // `tool-output-error` chunks (see `ToolFallback` / `MessageError`).
      return classified.suggestion
        ? `${classified.message} — ${classified.suggestion}`
        : classified.message
    },
    onEnd: () => {
      // Close any connected custom MCP servers now that the stream is done.
      if (mcpCloseAll) {
        mcpCloseAll().catch((e) => {
          console.error('[Agent API] MCP closeAll error:', e)
        })
      }

      if (AGENT_DEBUG_LOGS && usageSteps.length > 0) {
        console.log(
          '[Agent API] Session usage:',
          buildStats(lastStepModelId || model)
        )
      }
    },
    originalMessages: uiMessages as unknown as UIMessage[],
  })

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
    },
  })
}
