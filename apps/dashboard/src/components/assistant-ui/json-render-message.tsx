'use client'

'use no memo'

/**
 * Renders `@json-render` generative-UI specs that the agent streams as
 * `data-spec` message parts. Ported from the old `chat/message.tsx`; the same
 * size / element-count safety limits are enforced before rendering.
 */

import { ErrorBoundary } from 'react-error-boundary'

import type { Spec } from '@json-render/core'

import { useMessage } from '@assistant-ui/react'
import {
  type DataPart,
  getTextFromParts,
  Renderer,
  useJsonRenderMessage,
} from '@json-render/react'
import { useMemo } from 'react'
import {
  AGENT_JSON_RENDER_MAX_ELEMENT_COUNT,
  AGENT_JSON_RENDER_MAX_SPEC_BYTES,
  AGENT_JSON_RENDER_MAX_SPEC_PART_BYTES,
  AGENT_JSON_RENDER_MAX_SPEC_PARTS,
} from '@/lib/ai/agent/json-render-catalog'
import { AGENT_JSON_RENDER_CATALOG } from '@/lib/ai/agent/json-render-catalog-with-schema'
import { AGENT_JSON_RENDER_REGISTRY } from '@/lib/ai/agent/json-render-registry'

const encoder = new TextEncoder()

interface SafeJsonRenderResult {
  hasSpec: boolean
  spec: Spec | null
  text: string
  parseError: string | null
}

function getDataParts(parts: readonly unknown[]): DataPart[] {
  return parts.filter(
    (part): part is DataPart =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      typeof (part as { type: unknown }).type === 'string'
  )
}

function byteLength(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value)).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function countElements(spec: Spec | null): number {
  if (!spec || typeof spec !== 'object') return 0
  if (!('elements' in spec) || spec.elements == null) return 0
  if (typeof spec.elements !== 'object' || Array.isArray(spec.elements)) {
    return 0
  }
  return Object.keys(spec.elements as Record<string, unknown>).length
}

/**
 * Validate + sanitize a parsed json-render spec against the agent's safety
 * limits before it is rendered.
 */
export function validateAndSanitizeSpecFromParts(
  parts: readonly DataPart[],
  parsed: { spec: Spec | null; text: string; hasSpec: boolean }
): SafeJsonRenderResult {
  const text = parsed.text
  if (!parsed.hasSpec || !parsed.spec) {
    return { hasSpec: false, spec: null, text, parseError: null }
  }

  let specPartCount = 0
  let totalPartBytes = 0
  for (const part of parts) {
    if (part.type !== 'data-spec') continue
    specPartCount += 1
    const partBytes = byteLength((part as { data?: unknown }).data)
    totalPartBytes += partBytes
    if (partBytes > AGENT_JSON_RENDER_MAX_SPEC_PART_BYTES) {
      return {
        hasSpec: false,
        spec: null,
        text,
        parseError: `Inline UI patch data exceeded per-part limit (${AGENT_JSON_RENDER_MAX_SPEC_PART_BYTES} bytes).`,
      }
    }
  }

  if (specPartCount > AGENT_JSON_RENDER_MAX_SPEC_PARTS) {
    return {
      hasSpec: false,
      spec: null,
      text,
      parseError: `Too many inline UI patches (${specPartCount}).`,
    }
  }
  if (totalPartBytes > AGENT_JSON_RENDER_MAX_SPEC_BYTES) {
    return {
      hasSpec: false,
      spec: null,
      text,
      parseError: `Inline UI patch data exceeded limit (${totalPartBytes} bytes).`,
    }
  }

  const compiled = parsed.spec
  if (byteLength(compiled) > AGENT_JSON_RENDER_MAX_SPEC_BYTES) {
    return {
      hasSpec: false,
      spec: null,
      text,
      parseError: 'Generated UI spec is too large.',
    }
  }
  if (countElements(compiled) > AGENT_JSON_RENDER_MAX_ELEMENT_COUNT) {
    return {
      hasSpec: false,
      spec: null,
      text,
      parseError: 'Generated UI has too many elements.',
    }
  }

  try {
    const validation = AGENT_JSON_RENDER_CATALOG.validate(compiled)
    if (!validation.success) {
      return {
        hasSpec: false,
        spec: null,
        text,
        parseError: 'Generated UI spec is invalid. Skipping inline rendering.',
      }
    }
    return {
      hasSpec: true,
      spec: (validation.data as Spec | null) ?? compiled,
      text,
      parseError: null,
    }
  } catch {
    return {
      hasSpec: false,
      spec: null,
      text,
      parseError: 'Generated UI spec is invalid. Skipping inline rendering.',
    }
  }
}

function useSafeJsonRender(parts: readonly unknown[]): SafeJsonRenderResult {
  const dataParts = useMemo(() => getDataParts(parts), [parts])
  const parsed = useJsonRenderMessage(dataParts)
  const { hasSpec, spec, text } = parsed

  return useMemo(() => {
    try {
      return validateAndSanitizeSpecFromParts(dataParts, {
        hasSpec,
        spec,
        text,
      })
    } catch {
      return {
        hasSpec: false,
        spec: null,
        text: getTextFromParts(dataParts),
        parseError: 'Unable to parse inline UI payload.',
      }
    }
  }, [dataParts, hasSpec, spec, text])
}

/**
 * Reads the active assistant message's parts and renders any json-render
 * generative UI. Mounted once per assistant message after its text/tool parts.
 */
export function JsonRenderMessage() {
  const parts = useMessage((message) => message.content) as readonly unknown[]
  const isRunning = useMessage((message) => message.status?.type === 'running')
  const jsonRender = useSafeJsonRender(parts ?? [])

  if (!jsonRender.hasSpec && !jsonRender.parseError) return null

  return (
    <div className="mt-2">
      {jsonRender.hasSpec && jsonRender.spec ? (
        <ErrorBoundary fallbackRender={() => null}>
          <Renderer
            spec={jsonRender.spec}
            registry={AGENT_JSON_RENDER_REGISTRY}
            loading={isRunning}
          />
        </ErrorBoundary>
      ) : (
        <div className="rounded border border-[var(--chart-yellow)]/40 bg-[var(--chart-yellow)]/10 p-2 text-xs text-[var(--chart-yellow)]">
          {jsonRender.parseError}
        </div>
      )}
    </div>
  )
}
