import { getFollowUpPrompts } from '../follow-up-prompts'
import { STARTER_PROMPTS } from '../suggested-prompts'
import { describe, expect, test } from 'bun:test'

describe('getFollowUpPrompts', () => {
  test('routes slow-query exchanges to performance follow-ups', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'What are the slowest queries today?',
      lastAssistantText: 'Here are the 5 slowest queries in the last 24h.',
    })

    expect(prompts).toEqual([
      'Explain the slowest one',
      'Show its EXPLAIN plan',
      'Compare to yesterday',
    ])
  })

  test('routes table/storage exchanges to storage follow-ups', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'Show me the largest tables by disk usage',
      lastAssistantText: 'events_local uses 400GB of disk across 12 parts.',
    })

    expect(prompts).toEqual([
      'Show largest partitions',
      'Suggest a TTL',
      'Break down by column',
    ])
  })

  test('routes replication exchanges to replication follow-ups', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'How is replication lag looking?',
      lastAssistantText: 'All replicas are within 2 seconds of the leader.',
    })

    expect(prompts).toEqual([
      'Show the replication queue',
      'Which replica is behind?',
    ])
  })

  test('matches on assistant text alone when the user question is generic', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'What just happened?',
      lastAssistantText: 'One replica fell behind in the ZooKeeper queue.',
    })

    expect(prompts[0]).toBe('Show the replication queue')
  })

  test('matches on tool names used, not just message text', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'Anything I should know?',
      lastAssistantText: 'Everything looks fine.',
      toolsUsed: ['get_replication_queue'],
    })

    expect(prompts[0]).toBe('Show the replication queue')
  })

  test('matches the plural form of a keyword (e.g. "tables")', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'How many tables do we have?',
      lastAssistantText: 'There are 42 tables across 3 databases.',
    })

    expect(prompts[0]).toBe('Show largest partitions')
  })

  test('does not match a keyword that is only a substring of another word', () => {
    // "table" must not fire on "notable"/"acceptable" — whole-word match only.
    const prompts = getFollowUpPrompts({
      lastUserText: 'Anything worth flagging?',
      lastAssistantText: 'There are no notable or acceptable anomalies.',
    })

    expect(prompts).toEqual(
      STARTER_PROMPTS.slice(0, 2).map((prompt) => prompt.text)
    )
  })

  test('falls back to starter prompts when nothing matches', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'Hello there',
      lastAssistantText: 'Hi! How can I help?',
    })

    expect(prompts).toEqual(
      STARTER_PROMPTS.slice(0, 2).map((prompt) => prompt.text)
    )
  })

  test('respects a smaller limit', () => {
    const prompts = getFollowUpPrompts({
      lastUserText: 'slowest query please',
      lastAssistantText: '',
      limit: 1,
    })

    expect(prompts).toEqual(['Explain the slowest one'])
  })

  test('returns an empty array for a zero or negative limit', () => {
    expect(
      getFollowUpPrompts({ lastUserText: 'slow query', limit: 0 })
    ).toEqual([])
    expect(
      getFollowUpPrompts({ lastUserText: 'slow query', limit: -5 })
    ).toEqual([])
  })

  test('handles no arguments at all', () => {
    const prompts = getFollowUpPrompts()
    expect(prompts).toEqual(STARTER_PROMPTS.slice(0, 2).map((p) => p.text))
  })
})
