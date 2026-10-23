import {
  type AttributionInput,
  buildAttributionRecord,
  encodeLogComment,
  encodeSqlComment,
  MAX_LOG_COMMENT_BYTES,
} from '../record'
import { describe, expect, it } from 'bun:test'

const base: AttributionInput = {
  version: '0.3.0+f679398',
  user: 'jane',
  email: null,
  host: 'ch-0',
  source: 'chart:query-count',
  page: '/overview',
  label: 'region=eu-west,env=prod',
}

const bytes = (s: string) => new TextEncoder().encode(s).length

/**
 * Every field can come from a request header (trusted-auth subject, Referer).
 * A crafted value must never change the SQL or produce a `log_comment` the
 * server or the usage page cannot parse.
 */
const CRAFTED = [
  `jane"}, "user":"admin`,
  'jane */ DROP TABLE x; /*',
  'jane\nSELECT 1\r\n--',
  "o'brien\\",
  '\u0000\u001b[31mred\u2028',
  'x'.repeat(10_000),
  '日本語'.repeat(4000),
]

describe('encodeLogComment', () => {
  it('carries the schema fields as parseable JSON', () => {
    const parsed = JSON.parse(encodeLogComment(buildAttributionRecord(base)))
    expect(parsed).toEqual({
      app: 'chmonitor',
      v: 1,
      version: '0.3.0+f679398',
      user: 'jane',
      host: 'ch-0',
      source: 'chart:query-count',
      page: '/overview',
      label: 'region=eu-west,env=prod',
    })
  })

  it('keeps user null for anonymous and cron queries', () => {
    const parsed = JSON.parse(
      encodeLogComment(
        buildAttributionRecord({ ...base, user: null, source: 'cron:sweep' })
      )
    )
    expect(parsed.user).toBeNull()
    expect(parsed.source).toBe('cron:sweep')
  })

  it.each(CRAFTED)('round-trips crafted value %#, within the size cap', (v) => {
    const record = buildAttributionRecord({
      version: v,
      user: v,
      email: v,
      host: v,
      source: v,
      page: v,
      label: v,
    })
    const json = encodeLogComment(record)
    expect(bytes(json)).toBeLessThanOrEqual(MAX_LOG_COMMENT_BYTES)
    const parsed = JSON.parse(json)
    expect(parsed.app).toBe('chmonitor')
    expect(parsed.v).toBe(1)
    const values = Object.values(parsed).filter((x) => typeof x === 'string')
    expect(values.some((x) => [...x].some((c) => c.charCodeAt(0) < 0x20))).toBe(
      false
    )
  })

  it('cannot spoof another field through a quoted value', () => {
    const parsed = JSON.parse(
      encodeLogComment(
        buildAttributionRecord({ ...base, user: `jane","user":"admin` })
      )
    )
    expect(parsed.user).toBe('jane_,_user_:_admin')
  })

  /**
   * Cached and readonly=1 queries carry only the SQL comment, so the usage
   * page reads a mix of both carriers. If they disagreed, one person would
   * show up as two users.
   */
  it('holds the same user, source, host and label as the SQL comment', () => {
    const record = buildAttributionRecord({
      ...base,
      user: 'Jane Doe@corp.example',
      label: 'env=prod eu',
      source: 'api:/api/v1/x y',
      host: 'ch 東京',
    })
    const log = JSON.parse(encodeLogComment(record))
    const comment = encodeSqlComment(record)
    const body = JSON.parse(comment.slice(3, -4))
    for (const key of ['version', 'user', 'source', 'host', 'label']) {
      expect(log[key]).toBe(body[key])
    }
    expect(log.user).toBe('Jane_Doe')
  })

  it('keeps the email only in the opt-in email field', () => {
    const log = JSON.parse(
      encodeLogComment(
        buildAttributionRecord({
          ...base,
          user: 'jane@corp.example',
          email: 'jane@corp.example',
        })
      )
    )
    expect(log.user).toBe('jane')
    expect(log.email).toBe('jane@corp.example')
  })
})

/** The JSON body of a leading comment; throws when it is not one line of JSON. */
function commentBody(comment: string): Record<string, unknown> {
  expect(comment.startsWith('/* ')).toBe(true)
  expect(comment.endsWith(' */\n')).toBe(true)
  return JSON.parse(comment.slice(3, -4))
}

describe('encodeSqlComment', () => {
  it('is one leading block comment of JSON, client key first', () => {
    expect(encodeSqlComment(buildAttributionRecord(base))).toBe(
      '/* {"client":"clickhouse-monitoring","app":"chmonitor","v":1,"version":"0.3.0+f679398","user":"jane","source":"chart:query-count","host":"ch-0","label":"region=eu-west,env=prod"} */\n'
    )
  })

  it('keeps the key existing self-filters match on', () => {
    expect(encodeSqlComment(buildAttributionRecord(base))).toContain(
      '"client":"clickhouse-monitoring"'
    )
  })

  it('writes null for an anonymous or cron query', () => {
    const body = commentBody(
      encodeSqlComment(buildAttributionRecord({ ...base, user: null }))
    )
    expect(body.user).toBeNull()
  })

  it.each(CRAFTED)('cannot close, nest, or break the comment with %#', (v) => {
    const comment = encodeSqlComment(
      buildAttributionRecord({
        ...base,
        version: v,
        user: v,
        host: v,
        source: v,
        page: v,
        label: v,
      })
    )
    const inner = comment.slice(2, -3)
    expect(inner).not.toContain('*')
    expect(inner).not.toMatch(/[\r\n'\\]/)
    expect(comment.split('\n')).toHaveLength(2)
    expect(comment.length).toBeLessThan(600)
    const body = commentBody(comment)
    for (const key of ['version', 'user', 'source', 'host', 'label']) {
      const value = body[key]
      if (value !== null)
        expect(String(value)).toMatch(/^[A-Za-z0-9._:/=,+-]{1,64}$/)
    }
  })

  it('never writes the email, even when the record has one', () => {
    const comment = encodeSqlComment(
      buildAttributionRecord({ ...base, email: 'jane@example.com' })
    )
    expect(comment).not.toContain('example.com')
    expect(comment).not.toContain('@')
  })

  it('cuts an email-shaped subject to the part before @', () => {
    const body = commentBody(
      encodeSqlComment(
        buildAttributionRecord({ ...base, user: 'jane.doe@example.com' })
      )
    )
    expect(body.user).toBe('jane.doe')
  })
})
