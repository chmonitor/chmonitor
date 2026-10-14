// parse-email.ts — MIME parsing layer for the bug-handler worker.
//
// Uses postal-mime (workerd-compatible) to turn the raw email stream into a
// structured object.  extractSentryMeta does a best-effort parse of common
// Sentry alert fields from the subject/body; it never throws.

import PostalMime from 'postal-mime'

export interface SentryMeta {
  /** Full Sentry issue URL, e.g. https://chmonitor.sentry.io/issues/12345/ */
  issueUrl?: string
  /** Severity level: error | warning | fatal | info */
  level?: 'error' | 'warning' | 'fatal' | 'info'
  /** Sentry project slug */
  project?: string
  /** Deployment environment (production, staging, …) */
  environment?: string
  /** Short ID or culprit string, e.g. "CHMONITOR-1A2B" or "app/views.py in get" */
  shortId?: string
  /** Human-readable culprit location */
  culprit?: string
}

export interface ParsedEmail {
  from: string
  fromName?: string
  to: string[]
  subject: string
  text: string
  html?: string
  sentry?: SentryMeta
}

const RE_SENTRY_URL = /https:\/\/[a-z0-9-]+\.sentry\.io\/issues\/[^\s"')>]*/i

/**
 * Level detection patterns in priority order.
 *
 * For the email subject we match bare keywords (Sentry puts "[error]" or
 * "Error:" there).  For the body we require a "Level: X" label to avoid
 * false positives from common words like "more info" or "error handling".
 */
const LEVEL_SUBJECT_RE = /\b(fatal|error|warning|info)\b/i
// Matches "Level: error", "level:fatal", etc.
const LEVEL_LABEL_RE = /\blevel[:\s]+(fatal|error|warning|info)\b/i

const RE_PROJECT = /\bproject(?:\s+name)?[:\s]+([^\s,\n|]+)/i

const RE_ENV = /\benvironment[:\s]+([^\s,\n|]+)/i

/**
 * Sentry short IDs look like "PROJ-1A2B" or "PROJ-123".
 * Match the first word that looks like an all-caps project prefix + dash + alphanumeric.
 */
const RE_SHORT_ID = /\b([A-Z][A-Z0-9_-]+-[A-Z0-9]{3,})\b/

/**
 * Culprit lines often appear after "Culprit:" or "in " patterns in the body.
 * We look for the first "Culprit:" label.
 */
const RE_CULPRIT = /\bculprit[:\s]+([^\n]+)/i

/**
 * Best-effort extraction of Sentry alert metadata from a parsed email.
 * Returns undefined when no Sentry signals are found.
 * Never throws.
 */
export function extractSentryMeta(
  subject: string,
  text: string
): SentryMeta | undefined {
  try {
    const combined = `${subject}\n${text}`

    const urlMatch = combined.match(RE_SENTRY_URL)
    const issueUrl = urlMatch ? urlMatch[0].replace(/['")\s]+$/, '') : undefined

    // Level: prefer subject keyword match, then a structured "Level: X" label
    // in the body.  Never scan the body for bare keywords — too many false
    // positives (e.g. "more info", "error handling").
    let level: SentryMeta['level'] | undefined
    const subjectLevelMatch = subject.match(LEVEL_SUBJECT_RE)
    if (subjectLevelMatch) {
      level = subjectLevelMatch[1].toLowerCase() as SentryMeta['level']
    } else {
      const bodyLevelMatch = text.match(LEVEL_LABEL_RE)
      if (bodyLevelMatch) {
        level = bodyLevelMatch[1].toLowerCase() as SentryMeta['level']
      }
    }

    const projectMatch = combined.match(RE_PROJECT)
    const project = projectMatch ? projectMatch[1].trim() : undefined

    const envMatch = combined.match(RE_ENV)
    const environment = envMatch ? envMatch[1].trim() : undefined

    const culpritMatch = combined.match(RE_CULPRIT)
    const culprit = culpritMatch ? culpritMatch[1].trim() : undefined

    const shortIdMatch = combined.match(RE_SHORT_ID)
    const shortId = shortIdMatch ? shortIdMatch[1] : undefined

    // Only return metadata when at least one Sentry signal exists
    if (
      !issueUrl &&
      !level &&
      !project &&
      !environment &&
      !culprit &&
      !shortId
    ) {
      return undefined
    }

    const meta: SentryMeta = {}
    if (issueUrl) meta.issueUrl = issueUrl
    if (level) meta.level = level
    if (project) meta.project = project
    if (environment) meta.environment = environment
    if (culprit) meta.culprit = culprit
    if (shortId) meta.shortId = shortId

    return meta
  } catch {
    // Never propagate — best-effort only
    return undefined
  }
}

/**
 * Parse a raw email (ReadableStream, ArrayBuffer, or string) into a structured
 * `ParsedEmail` object.  Uses postal-mime which is fully workerd-compatible.
 */
export async function parseEmail(
  raw: ReadableStream<Uint8Array> | ArrayBuffer | string
): Promise<ParsedEmail> {
  const parser = new PostalMime()

  // postal-mime accepts ArrayBuffer or string directly; for ReadableStream we
  // must collect the bytes first.
  let input: ArrayBuffer | string
  if (raw instanceof ReadableStream) {
    const reader = raw.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    // Concatenate into a single Uint8Array then get its underlying buffer
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    input = merged.buffer
  } else {
    input = raw
  }

  const parsed = await parser.parse(input)

  // Normalise the from field — postal-mime exposes { address, name }
  const fromAddress = parsed.from?.address ?? ''
  const fromName = parsed.from?.name || undefined

  // Collect all To addresses
  const to = (parsed.to ?? [])
    .map((r) => r.address)
    .filter((a): a is string => Boolean(a))

  const subject = parsed.subject ?? ''
  const text = parsed.text ?? ''
  const html = parsed.html || undefined

  const sentry = extractSentryMeta(subject, text)

  return { from: fromAddress, fromName, to, subject, text, html, sentry }
}
