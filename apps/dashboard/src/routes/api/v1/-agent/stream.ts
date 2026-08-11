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
import { classifyError } from '@/lib/ai/agent/errors'
import { createJsonRenderPatchGuardStream } from '@/lib/ai/agent/json-render-patch-guard'
import { meterAiOverage } from '@/lib/billing/ai-usage-store'

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
  } = options

  const usageSteps: LanguageModelUsage[] = []
  // Tracks the provider-reported model ID from the last completed step.
  // Populated synchronously in onStepEnd so it is available after consumeStream().
  let lastStepModelId: string | undefined

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
            pipeJsonRender(result.toUIMessageStream())
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
        const classified = classifyError(error, {
          model,
          provider: requestedProvider,
        })
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
      const classified = classifyError(error, {
        model,
        provider: requestedProvider,
      })
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
      return JSON.stringify(classified)
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
