import { isSenderAllowed, parseConfig } from './config'
import { describe, expect, it } from 'bun:test'

describe('parseConfig — defaults', () => {
  it('uses default labels when BUG_ISSUE_LABELS is absent', () => {
    const cfg = parseConfig({})
    expect(cfg.labels).toEqual(['bug', 'sentry', 'automated'])
  })

  it('uses empty assignees by default', () => {
    const cfg = parseConfig({})
    expect(cfg.assignees).toEqual([])
  })

  it('uses empty titlePrefix by default', () => {
    const cfg = parseConfig({})
    expect(cfg.titlePrefix).toBe('')
  })

  it('uses the GitHub API base URL by default', () => {
    const cfg = parseConfig({})
    expect(cfg.apiBase).toBe('https://api.github.com')
  })

  it('targetAddress is undefined when env var absent', () => {
    const cfg = parseConfig({})
    expect(cfg.targetAddress).toBeUndefined()
  })

  it('githubRepo is null when GITHUB_REPOSITORY absent', () => {
    const cfg = parseConfig({})
    expect(cfg.githubRepo).toBeNull()
  })
})

describe('parseConfig — comma-list parsing', () => {
  it('splits BUG_ISSUE_LABELS on comma and trims whitespace', () => {
    const cfg = parseConfig({ BUG_ISSUE_LABELS: 'bug , sentry , p1 ' })
    expect(cfg.labels).toEqual(['bug', 'sentry', 'p1'])
  })

  it('splits BUG_ISSUE_ASSIGNEES', () => {
    const cfg = parseConfig({ BUG_ISSUE_ASSIGNEES: 'duyetbot, octocat' })
    expect(cfg.assignees).toEqual(['duyetbot', 'octocat'])
  })

  it('drops empty entries in comma lists', () => {
    const cfg = parseConfig({ BUG_ISSUE_LABELS: 'bug,,sentry,' })
    expect(cfg.labels).toEqual(['bug', 'sentry'])
  })

  it('splits BUG_ALLOWED_SENDERS and lower-cases', () => {
    const cfg = parseConfig({
      BUG_ALLOWED_SENDERS: 'Alerts@Sentry.IO, @noreply.github.com',
    })
    expect(cfg.allowedSenders).toEqual([
      'alerts@sentry.io',
      '@noreply.github.com',
    ])
  })
})

describe('parseConfig — BUG_ALLOWED_SENDERS fail-closed semantics', () => {
  it('unset -> built-in Sentry-only default', () => {
    const cfg = parseConfig({})
    expect(cfg.allowedSenders).toEqual([
      '@sentry.io',
      '@notifications.sentry.io',
    ])
  })

  it('explicitly empty string -> rejects every sender', () => {
    const cfg = parseConfig({ BUG_ALLOWED_SENDERS: '' })
    expect(cfg.allowedSenders).toEqual([])
  })

  it('"*" -> allows every sender', () => {
    const cfg = parseConfig({ BUG_ALLOWED_SENDERS: '*' })
    expect(cfg.allowedSenders).toEqual(['*'])
  })

  it('explicit list is unchanged by the fail-closed default', () => {
    const cfg = parseConfig({ BUG_ALLOWED_SENDERS: '@sentry.io' })
    expect(cfg.allowedSenders).toEqual(['@sentry.io'])
  })
})

describe('parseConfig — GITHUB_REPOSITORY parsing', () => {
  it('parses a valid owner/repo', () => {
    const cfg = parseConfig({ GITHUB_REPOSITORY: 'chmonitor/chmonitor' })
    expect(cfg.githubRepo).toEqual({ owner: 'chmonitor', repo: 'chmonitor' })
  })

  it('returns null for an empty string', () => {
    const cfg = parseConfig({ GITHUB_REPOSITORY: '' })
    expect(cfg.githubRepo).toBeNull()
  })

  it('returns null when there is no slash', () => {
    const cfg = parseConfig({ GITHUB_REPOSITORY: 'chmonitor' })
    expect(cfg.githubRepo).toBeNull()
  })

  it('returns null when the slash is at the start', () => {
    const cfg = parseConfig({ GITHUB_REPOSITORY: '/repo' })
    expect(cfg.githubRepo).toBeNull()
  })

  it('returns null when the slash is at the end', () => {
    const cfg = parseConfig({ GITHUB_REPOSITORY: 'owner/' })
    expect(cfg.githubRepo).toBeNull()
  })

  it('returns null for a/b/c (too many slashes)', () => {
    const cfg = parseConfig({ GITHUB_REPOSITORY: 'a/b/c' })
    expect(cfg.githubRepo).toBeNull()
  })

  it('trims whitespace around the value', () => {
    const cfg = parseConfig({ GITHUB_REPOSITORY: '  chmonitor/chmonitor  ' })
    expect(cfg.githubRepo).toEqual({ owner: 'chmonitor', repo: 'chmonitor' })
  })
})

describe('parseConfig — GITHUB_API_BASE override', () => {
  it('overrides the default API base', () => {
    const cfg = parseConfig({
      GITHUB_API_BASE: 'https://ghes.example.com/api/v3',
    })
    expect(cfg.apiBase).toBe('https://ghes.example.com/api/v3')
  })
})

describe('parseConfig — trimming', () => {
  it('trims BUG_HANDLER_TARGET_ADDRESS', () => {
    const cfg = parseConfig({
      BUG_HANDLER_TARGET_ADDRESS: '  bug@chmonitor.dev  ',
    })
    expect(cfg.targetAddress).toBe('bug@chmonitor.dev')
  })

  it('trims GITHUB_TOKEN', () => {
    const cfg = parseConfig({ GITHUB_TOKEN: '  ghp_abc123  ' })
    expect(cfg.githubToken).toBe('ghp_abc123')
  })
})

describe('isSenderAllowed', () => {
  it('rejects any sender when the list is empty (fail closed)', () => {
    expect(isSenderAllowed('anyone@anywhere.com', [])).toBe(false)
  })

  it('allows any sender when the list contains the "*" wildcard', () => {
    expect(isSenderAllowed('anyone@anywhere.com', ['*'])).toBe(true)
  })

  it('matches exact address (case-insensitive)', () => {
    expect(isSenderAllowed('Alerts@Sentry.IO', ['alerts@sentry.io'])).toBe(true)
  })

  it('matches @domain rule', () => {
    expect(isSenderAllowed('no-reply@sentry.io', ['@sentry.io'])).toBe(true)
  })

  it('matches plain domain suffix (sentry.io matches @sentry.io)', () => {
    expect(isSenderAllowed('alerts@sentry.io', ['sentry.io'])).toBe(true)
  })

  it('rejects an address not in the allowlist', () => {
    expect(isSenderAllowed('spam@evil.com', ['@sentry.io'])).toBe(false)
  })

  it('rejects a subdomain that does not end with the rule domain', () => {
    expect(isSenderAllowed('x@notsentry.io', ['sentry.io'])).toBe(false)
  })
})
