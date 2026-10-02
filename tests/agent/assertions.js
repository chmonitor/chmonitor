/**
 * Shared deterministic promptfoo assertions for the live agent eval.
 *
 * They read the string built by parse-agent-sse.js (`[tool:x]`,
 * `[tool-error:x: why]`, answer text). Use them instead of llm-rubric where
 * the grader model is unreliable.
 *
 *   - type: javascript
 *     value: file://./assertions.js:toolCalled
 *     config:
 *       tools: [get_replication_status, query]   # any one of these
 *
 * Infra tolerance: the public demo ClickHouse is sometimes down (Cloudflare
 * `error code: 1033`, refused connections, gateway errors). A tool that failed
 * for that reason says nothing about the agent, so the case passes as an
 * "infra skip" instead of turning the suite red. Any other tool-error is a real
 * failure.
 */

const INFRA_ERROR =
  /\[tool-error:[^\]]*(?:\b1033\b|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|\b50[234]\b|bad gateway|service unavailable|gateway timeout)/i

const TOOL_ERROR = /\[tool-error:[^\]]*\]/g

function toolNames(output) {
  const names = new Set()
  for (const m of String(output || '').matchAll(/\[tool:([a-z0-9_]+)\]/g)) {
    names.add(m[1])
  }
  return names
}

function isInfraSkip(output) {
  return INFRA_ERROR.test(String(output || ''))
}

/** Pass when any of `config.tools` was called (any tool when omitted). */
function toolCalled(output, context) {
  const wanted = context?.config?.tools || []
  const called = toolNames(output)
  const text = String(output || '')

  if (isInfraSkip(text)) {
    return {
      pass: true,
      score: 1,
      reason: 'infra skip: tool hit a demo outage',
    }
  }
  const realErrors = text.match(TOOL_ERROR) || []
  if (realErrors.length > 0) {
    return { pass: false, score: 0, reason: `tool failed: ${realErrors[0]}` }
  }
  const hit =
    wanted.length === 0 ? called.size > 0 : wanted.some((t) => called.has(t))
  return {
    pass: hit,
    score: hit ? 1 : 0,
    reason: hit
      ? `called ${[...called].join(', ')}`
      : `expected one of [${wanted.join(', ')}], called [${[...called].join(', ')}]`,
  }
}

/** Pass when no tool ran at all (off-topic, refusals before any lookup). */
function noToolCalled(output) {
  const called = [...toolNames(output)]
  return {
    pass: called.length === 0,
    score: called.length === 0 ? 1 : 0,
    reason:
      called.length === 0 ? 'no tool called' : `unexpected tools: ${called}`,
  }
}

module.exports = { toolCalled, noToolCalled, isInfraSkip, INFRA_ERROR }
