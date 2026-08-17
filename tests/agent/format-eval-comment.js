/**
 * Turn promptfoo JSON (or a skip reason) into a sticky PR comment body.
 */

const MARKER = '<!-- agent-eval-comment -->'

function extractRows(json) {
  if (Array.isArray(json)) return json
  if (!json || typeof json !== 'object') return []
  if (Array.isArray(json.results)) return json.results
  const inner = json.results
  if (inner && typeof inner === 'object' && Array.isArray(inner.results)) {
    return inner.results
  }
  return []
}

function rowPassed(row) {
  if (typeof row.success === 'boolean') return row.success
  if (row.gradingResult && typeof row.gradingResult.pass === 'boolean') {
    return row.gradingResult.pass
  }
  return false
}

function rowDescription(row, index) {
  return (
    row.description ||
    row.testCase?.description ||
    row.vars?.prompt ||
    row.testCase?.vars?.prompt ||
    `case ${index + 1}`
  )
}

function failReason(row) {
  const bits = []
  if (row.gradingResult?.reason) bits.push(String(row.gradingResult.reason))
  for (const part of row.gradingResult?.componentResults ?? []) {
    if (part && part.pass === false && part.reason) {
      bits.push(String(part.reason))
    }
  }
  if (row.error) bits.push(String(row.error))
  const text = bits.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > 240 ? `${text.slice(0, 237)}…` : text
}

function summarize(json) {
  const rows = extractRows(json)
  const passed = rows.filter(rowPassed).length
  const failed = rows.length - passed
  const total = rows.length
  const scorePct = total === 0 ? 0 : Math.round((passed / total) * 100)
  const status =
    total === 0 ? 'NO_RESULTS' : failed === 0 ? 'PASS' : 'FAIL'
  return { rows, passed, failed, total, scorePct, status }
}

function formatScoreboard(summary, extra = {}) {
  const lines = [
    `| | |`,
    `|---|---|`,
    `| Status | **${summary.status}** |`,
    `| Score | **${summary.scorePct}%** |`,
    `| Tests | ${summary.total} |`,
    `| Passed | ${summary.passed} |`,
    `| Failed | ${summary.failed} |`,
  ]
  const shareUrl = extra.shareUrl || summary.shareUrl
  if (shareUrl) {
    lines.push(`| Report | [promptfoo.app](${shareUrl}) |`)
  }
  return lines.join('\n')
}

function formatSkipComment(reason) {
  return `${MARKER}
## Agent eval (promptfoo)

_Skipped:_ ${reason}

Set repo secret \`ANYROUTER_API_KEY\` to run live goldens against the public
agent. \`AGENT_API_TOKEN\` is optional (cloud guests work without it).
SSE parser tests still run in \`unit-tests\`.
`
}

function formatEvalComment(json, meta = {}) {
  const summary = summarize(json)
  const { rows, passed, failed, total, scorePct, status } = summary

  const model = meta.model || process.env.AGENT_EVAL_MODEL || ''
  const tags = meta.tags || ''
  const url = meta.url || process.env.AGENT_EVAL_URL || ''
  const shareUrl =
    meta.shareUrl ||
    (json && typeof json === 'object' && typeof json.shareableUrl === 'string'
      ? json.shareableUrl
      : '')

  const lines = [
    MARKER,
    '## Agent eval (promptfoo)',
    '',
    formatScoreboard(summary, { shareUrl }),
    '',
    `**${passed}/${total} passed** (${scorePct}%) — ${status}`,
  ]
  if (tags || model || url) {
    lines.push('')
    const bits = []
    if (tags) bits.push(`tags \`${tags}\``)
    if (model) bits.push(`model \`${model}\``)
    if (url) bits.push(`url \`${url}\``)
    lines.push(bits.join(' · '))
  }

  if (rows.length > 0) {
    lines.push('')
    lines.push('| Result | Case |')
    lines.push('|---|---|')
    for (const [i, row] of rows.entries()) {
      const ok = rowPassed(row)
      const desc = String(rowDescription(row, i)).replace(/\|/g, '\\|')
      const extra = !ok ? failReason(row) : ''
      const label = extra ? `${desc}<br>${extra.replace(/\|/g, '\\|')}` : desc
      lines.push(`| ${ok ? 'pass' : 'FAIL'} | ${label} |`)
    }
  } else {
    lines.push('')
    lines.push(
      'No scored rows in `tests/agent/results/latest.json`. See the workflow artifact.'
    )
  }

  lines.push('')
  lines.push(
    'Informational — does not block merge. Re-run via **Agent eval** workflow dispatch.'
  )
  lines.push('')
  return lines.join('\n')
}

module.exports = {
  MARKER,
  extractRows,
  summarize,
  formatScoreboard,
  formatSkipComment,
  formatEvalComment,
}
