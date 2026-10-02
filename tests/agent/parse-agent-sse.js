/**
 * Parse an AI SDK UI-message SSE body into a compact eval string.
 *
 * The agent stream uses `text-delta` with `delta` (current SDK) and
 * historically `textDelta`. Tool cards arrive as `tool-call`,
 * `tool-input-start`, or `tool-input-available`.
 *
 * Output shape (promptfoo assertions match this):
 *   [tool:list_databases]
 *   [tool-error:list_databases: <why the tool failed>]   (only when it failed)
 *   The cluster has 12 databases...
 *   [cost:$0.001234]
 */

function parseAgentSse(text) {
  const tools = []
  const seenTools = new Set()
  const errors = []
  const toolErrors = []
  const toolNames = new Map()
  const outputs = []
  let output = ''
  let costLine = ''

  const lines = String(text || '').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue
    const payload = trimmed.slice(6)
    if (payload === '[DONE]') continue
    let evt
    try {
      evt = JSON.parse(payload)
    } catch {
      continue
    }
    if (!evt || typeof evt !== 'object') continue

    if (evt.type === 'text-delta') {
      const chunk =
        typeof evt.delta === 'string'
          ? evt.delta
          : typeof evt.textDelta === 'string'
            ? evt.textDelta
            : ''
      output += chunk
    }

    const toolName =
      typeof evt.toolName === 'string'
        ? evt.toolName
        : typeof evt.toolCallId === 'string' && typeof evt.name === 'string'
          ? evt.name
          : null
    if (
      toolName &&
      (evt.type === 'tool-call' ||
        evt.type === 'tool-input-start' ||
        evt.type === 'tool-input-available')
    ) {
      if (typeof evt.toolCallId === 'string') {
        toolNames.set(evt.toolCallId, toolName)
      }
      if (!seenTools.has(toolName)) {
        seenTools.add(toolName)
        tools.push(toolName)
      }
    }

    if (evt.type === 'tool-output-available' && evt.output !== undefined) {
      try {
        const raw =
          typeof evt.output === 'string'
            ? evt.output
            : JSON.stringify(evt.output)
        if (raw && outputs.length < 3) {
          outputs.push(raw.length > 800 ? `${raw.slice(0, 797)}…` : raw)
        }
      } catch {
        // ignore unserializable tool output
      }
    }

    // A tool that failed (e.g. demo ClickHouse down) is otherwise invisible:
    // the output would be a bare `[tool:x]` indistinguishable from a model
    // that never answered. Surface it so triage can tell the two apart.
    if (evt.type === 'tool-output-error' && toolErrors.length < 3) {
      const name = toolNames.get(evt.toolCallId) || 'unknown'
      const line = `[tool-error:${name}: ${String(evt.errorText || 'unknown')}]`
      if (!toolErrors.includes(line)) toolErrors.push(line)
    }

    if (evt.type === 'data-usage') {
      const row = Array.isArray(evt.data) ? evt.data[0] : evt.data
      const cost = row?.estimatedCostUsd
      if (cost !== undefined && cost !== null) {
        costLine = `[cost:$${Number(cost).toFixed(6)}]`
      }
    }

    if (evt.type === 'error' || evt.type === 'data-error') {
      const reason =
        evt.errorText ||
        evt.reason ||
        (typeof evt.error === 'string' ? evt.error : null) ||
        'unknown'
      errors.push(String(reason))
    }
  }

  const parts = []
  for (const name of tools) {
    parts.push(`[tool:${name}]`)
  }
  for (const chunk of outputs) {
    parts.push(`[tool-output:${chunk}]`)
  }
  parts.push(...toolErrors)
  const answer = output.trim()
  if (answer) parts.push(answer)
  for (const err of errors) {
    parts.push(`[error:${err}]`)
  }
  if (costLine) parts.push(costLine)

  return parts.join('\n') || String(text || '').slice(0, 500)
}

module.exports = { parseAgentSse }

/** promptfoo `transformResponse` entry (json, text) => string */
module.exports.default = function transformResponse(_json, text) {
  return parseAgentSse(text)
}
