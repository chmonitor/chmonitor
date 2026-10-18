// buildIssue writes an agent-friendly markdown body; createGitHubIssue never
// throws, failures are captured in its return value.

import type { BugHandlerConfig } from './config'
import type { ParsedEmail } from './parse-email'

const MAX_TITLE_LEN = 256
// Cap the body text block to keep the issue under GitHub's 65 536-char limit.
const MAX_BODY_TEXT_CHARS = 60_000

export interface IssuePayload {
  title: string
  body: string
  labels: string[]
  assignees: string[]
}

export interface IssueResult {
  ok: boolean
  status: number
  /** The created issue's html_url on success */
  url?: string
  /** Response text on non-2xx */
  error?: string
}

export function buildIssue(
  parsed: ParsedEmail,
  config: BugHandlerConfig
): IssuePayload {
  const rawTitle = `${config.titlePrefix}${parsed.subject || 'Bug report (no subject)'}`
  const title =
    rawTitle.length > MAX_TITLE_LEN
      ? `${rawTitle.slice(0, MAX_TITLE_LEN - 1)}…`
      : rawTitle

  // ── Source table ────────────────────────────────────────────────────────────
  const sentry = parsed.sentry
  let sourceRows = `| Field | Value |\n| --- | --- |\n`
  sourceRows += `| From | \`${parsed.from}\`${parsed.fromName ? ` (${parsed.fromName})` : ''} |\n`
  sourceRows += `| To | ${parsed.to.join(', ') || '(unknown)'} |\n`
  sourceRows += `| Received by | chmonitor-bug-handler email worker |\n`

  if (sentry) {
    if (sentry.issueUrl) {
      sourceRows += `| Sentry issue | [${sentry.issueUrl}](${sentry.issueUrl}) |\n`
    }
    if (sentry.level) {
      sourceRows += `| Level | \`${sentry.level}\` |\n`
    }
    if (sentry.project) {
      sourceRows += `| Project | \`${sentry.project}\` |\n`
    }
    if (sentry.environment) {
      sourceRows += `| Environment | \`${sentry.environment}\` |\n`
    }
    if (sentry.shortId) {
      sourceRows += `| Short ID | \`${sentry.shortId}\` |\n`
    }
    if (sentry.culprit) {
      sourceRows += `| Culprit | \`${sentry.culprit}\` |\n`
    }
  }

  // ── Email body ──────────────────────────────────────────────────────────────
  // Collapse runs of 3+ blank lines to 2, then cap length.
  const cleanText = parsed.text
    .replace(/(\r?\n){3,}/g, '\n\n')
    .slice(0, MAX_BODY_TEXT_CHARS)

  const truncationNote =
    parsed.text.length > MAX_BODY_TEXT_CHARS
      ? `\n\n> ⚠️ Body truncated to ${MAX_BODY_TEXT_CHARS.toLocaleString()} characters.`
      : ''

  // ── Agent checklist ─────────────────────────────────────────────────────────
  const sentryLink = sentry?.issueUrl
    ? `\n- Open the Sentry issue for the full stack trace: ${sentry.issueUrl}`
    : ''

  const agentChecklist = `\
- [ ] Reproduce the reported error locally or in a staging environment.${sentryLink}
- [ ] Locate the culprit file / function using the stack trace or Sentry details above.
- [ ] Write a failing test that captures the bug (unit or integration, whichever is appropriate).
- [ ] Fix the root cause — patch only what is broken; do not introduce unrelated changes.
- [ ] Ensure the new test passes and the full test suite is green (\`bun test\`).
- [ ] Open a pull request that references this issue (\`Fixes #<issue-number>\`) and includes the new test.`

  // ── Assemble body ───────────────────────────────────────────────────────────
  const body = `## Summary

${parsed.subject || '(no subject)'}

## Source

${sourceRows}
## Details

\`\`\`
${cleanText}${truncationNote}
\`\`\`

## For the coding agent

${agentChecklist}

---
_Filed automatically by the bug-handler email worker._`

  return {
    title,
    body,
    labels: config.labels,
    assignees: config.assignees,
  }
}

export async function createGitHubIssue(
  issue: IssuePayload,
  config: BugHandlerConfig,
  fetchImpl: typeof fetch = fetch
): Promise<IssueResult> {
  const { githubRepo, githubToken, apiBase } = config

  if (!githubRepo || !githubToken) {
    return { ok: false, status: 0, error: 'missing githubRepo or githubToken' }
  }

  const { owner, repo } = githubRepo
  const url = `${apiBase}/repos/${owner}/${repo}/issues`

  const bodyObj: Record<string, unknown> = {
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
  }
  // Omitted when empty: GitHub rejects unknown usernames.
  if (issue.assignees.length > 0) {
    bodyObj.assignees = issue.assignees
  }

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'chmonitor-bug-handler',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(bodyObj),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, error: `fetch failed: ${message}` }
  }

  if (!response.ok) {
    let text = ''
    try {
      text = await response.text()
    } catch {
      // ignore body read failure
    }
    return { ok: false, status: response.status, error: text }
  }

  let data: Record<string, unknown> = {}
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    // ignore JSON parse failure on success
  }

  return {
    ok: true,
    status: response.status,
    url: typeof data.html_url === 'string' ? data.html_url : undefined,
  }
}
