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
 * failure. The same goes for the model router failing (`No output generated`,
 * 429/5xx) and an origin-down HTML page or truncated stream.
 *
 * NOT infra, always a failure: the Worker's own faults. A Cloudflare
 * "exceeded resource limits" / Error 1101 / 1102 page (the #3560 CPU class),
 * any other HTML page, an empty body, and a `data: {` stream that was cut
 * short without an infra marker. Masking those would read our bugs as green.
 */

const INFRA_ERROR =
  /\[tool-error:[^\]]*(?:\b1033\b|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|\b50[234]\b|bad gateway|service unavailable|gateway timeout)/i

// OUR bug, never a skip: Cloudflare's page for a Worker that blew its CPU or
// memory budget (#3560) or threw. Checked before any infra marker.
const WORKER_FAULT =
  /exceeded resource limits|Error 110[12]\b|error code: 110[12]\b|Worker threw exception|Worker exceeded/i

// Origin/tunnel class: the demo ClickHouse (or the origin behind the tunnel)
// is down. Matched inside an HTML page or a raw truncated stream.
const ORIGIN_DOWN =
  /Error (?:code:? )?(?:1033|50[234])\b|error code: (?:1033|50[234])\b|\b50[234] (?:bad gateway|service unavailable|gateway time-?out)|bad gateway|gateway time-?out|origin is unreachable|argo tunnel/i

// The model router failed, not the Worker.
const ROUTER_FAILURE =
  /\[error:[^\]]*(?:No output generated|stream ended|provider could not complete|rate limit|\b429\b|overloaded|temporarily unavailable|\b50[234]\b)/i

const TOOL_ERROR = /\[tool-error:[^\]]*\]/g

function toolNames(output) {
  const names = new Set()
  for (const m of String(output || '').matchAll(/\[tool:([a-z0-9_]+)\]/g)) {
    names.add(m[1])
  }
  return names
}

/**
 * Classify one output: `fault` (a real failure with a named reason), `infra`
 * (skip), or `ok` (judge it normally). Only the origin/tunnel and router
 * classes are infra; an unrecognised HTML page or a truncated stream is ours.
 */
function classify(output) {
  const text = String(output || '')
  if (WORKER_FAULT.test(text)) {
    return { kind: 'fault', reason: 'worker CPU/resource limit' }
  }
  if (/^\s*$/.test(text)) {
    return { kind: 'fault', reason: 'empty response' }
  }
  if (INFRA_ERROR.test(text)) return { kind: 'infra' }
  if (/^\s*(?:<!DOCTYPE html|<html)/i.test(text)) {
    return ORIGIN_DOWN.test(text)
      ? { kind: 'infra' }
      : {
          kind: 'fault',
          reason: 'unrecognised HTML page instead of an agent stream',
        }
  }
  if (/^\s*data: \{/.test(text)) {
    return ORIGIN_DOWN.test(text) || ROUTER_FAILURE.test(text)
      ? { kind: 'infra' }
      : { kind: 'fault', reason: 'stream truncated' }
  }
  if (ROUTER_FAILURE.test(text)) return { kind: 'infra' }
  return { kind: 'ok' }
}

function isInfraSkip(output) {
  return classify(output).kind === 'infra'
}

const SKIP = (why) => ({ pass: true, score: 1, reason: `infra skip: ${why}` })
const FAULT = (reason) => ({ pass: false, score: 0, reason })

/** Pass when any of `config.tools` was called (any tool when omitted). */
function toolCalled(output, context) {
  const wanted = context?.config?.tools || []
  const called = toolNames(output)
  const text = String(output || '')

  const v = classify(text)
  if (v.kind === 'fault') return FAULT(v.reason)
  if (v.kind === 'infra') return SKIP('tool hit a demo outage')
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

/**
 * Pass when the answer matches `config.pattern` (a RegExp source, matched
 * case-insensitively). An infra skip passes, so an outage is not a
 * wording failure.
 */
function answerMatches(output, context) {
  const v = classify(output)
  if (v.kind === 'fault') return FAULT(v.reason)
  if (v.kind === 'infra') return SKIP('no usable answer')
  const pattern = context?.config?.pattern
  const hit = new RegExp(pattern, 'i').test(String(output || ''))
  return {
    pass: hit,
    score: hit ? 1 : 0,
    reason: hit ? `matched /${pattern}/` : `no match for /${pattern}/`,
  }
}

/** Replaces `not-contains [error:`: a stream error fails unless it is infra. */
function noStreamError(output) {
  const v = classify(output)
  if (v.kind === 'fault') return FAULT(v.reason)
  const bad = /\[error:/.test(String(output || '')) && v.kind !== 'infra'
  return {
    pass: !bad,
    score: bad ? 0 : 1,
    reason: bad ? 'agent stream error' : 'no stream error (or infra skip)',
  }
}

/** Pass when no tool ran at all (off-topic, refusals before any lookup). */
function noToolCalled(output) {
  const v = classify(output)
  if (v.kind === 'fault') return FAULT(v.reason)
  if (v.kind === 'infra') return SKIP('no usable answer')
  const called = [...toolNames(output)]
  return {
    pass: called.length === 0,
    score: called.length === 0 ? 1 : 0,
    reason:
      called.length === 0 ? 'no tool called' : `unexpected tools: ${called}`,
  }
}

module.exports = {
  toolCalled,
  noToolCalled,
  answerMatches,
  noStreamError,
  classify,
  isInfraSkip,
  INFRA_ERROR,
}
