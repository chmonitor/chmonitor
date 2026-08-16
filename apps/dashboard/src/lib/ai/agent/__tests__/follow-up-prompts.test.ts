import { getFollowUpPrompts } from '../follow-up-prompts'
import { STARTER_PROMPTS } from '../suggested-prompts'
import { describe, expect, test } from 'bun:test'

describe('getFollowUpPrompts', () => {
  describe('tool-driven relevance (primary signal)', () => {
    test('routes storage-tool exchanges to genuinely different next steps', () => {
      const prompts = getFollowUpPrompts({
        lastUserText: 'Show me the largest tables by disk usage',
        lastAssistantText: 'events_local uses 400GB of disk across 12 parts.',
        toolsUsed: ['get_table_parts'],
      })

      // Must not re-ask for what get_table_parts already answered.
      expect(prompts).not.toContain('Show largest partitions')
      expect(prompts).toEqual([
        'Suggest a TTL for this table',
        'Forecast when disk fills up',
        'Check current merge activity',
      ])
    })

    test('routes replication-tool exchanges away from data the tool already returned', () => {
      const prompts = getFollowUpPrompts({
        lastUserText: 'How is replication lag looking?',
        lastAssistantText: 'All replicas are within 2 seconds of the leader.',
        toolsUsed: ['get_replication_status'],
      })

      // get_replication_status already returns queue_size/absolute_delay per
      // replica, so re-asking for the queue or "which replica" is redundant.
      expect(prompts).not.toContain('Show the replication queue')
      expect(prompts).not.toContain('Which replica is behind?')
      expect(prompts[0]).toBe('Check for a merge backlog on that table')
    })

    test('prioritizes the most recently used tool over earlier tools in the turn', () => {
      const prompts = getFollowUpPrompts({
        toolsUsed: ['get_metrics', 'get_slow_queries'],
      })

      expect(prompts[0]).toBe("Explain the slowest query's plan")
    })

    test('drops a candidate whose related tool ran earlier in the same turn', () => {
      // get_disk_usage's "show which tables use the most space" candidate
      // maps to get_table_parts, which already ran — must be filtered.
      const prompts = getFollowUpPrompts({
        toolsUsed: ['get_disk_usage', 'get_table_parts'],
      })

      expect(prompts).not.toContain('Show which tables use the most space')
    })

    test('merges candidates from multiple tools used in one turn, deduped', () => {
      const prompts = getFollowUpPrompts({
        toolsUsed: ['get_merge_status', 'get_disk_usage'],
        limit: 5,
      })

      const unique = new Set(prompts)
      expect(unique.size).toBe(prompts.length)
      expect(prompts.length).toBeGreaterThan(0)
    })

    test('never suggests a destructive control-tool action', () => {
      const prompts = getFollowUpPrompts({
        toolsUsed: ['kill_query'],
        lastAssistantText: 'Killed the runaway query.',
      })

      for (const prompt of prompts) {
        expect(prompt.toLowerCase()).not.toContain('kill')
      }
    })

    test('ignores unmapped/unknown tool names and falls through gracefully', () => {
      const prompts = getFollowUpPrompts({
        toolsUsed: ['some_unmapped_tool'],
        lastUserText: 'Hello there',
        lastAssistantText: 'Hi! How can I help?',
      })

      expect(prompts).toEqual(STARTER_PROMPTS.slice(0, 2).map((p) => p.text))
    })
  })

  describe('keyword fallback (no matching tool call)', () => {
    test('routes slow-query exchanges to performance follow-ups', () => {
      const prompts = getFollowUpPrompts({
        lastUserText: 'What are the slowest queries today?',
        lastAssistantText: 'Here are the 5 slowest queries in the last 24h.',
      })

      expect(prompts).toEqual([
        "Explain the slowest query's plan",
        'Estimate its cost',
        'Check for repeating slow patterns',
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
        'Forecast when disk fills up',
      ])
    })

    test('matches on assistant text alone when the user question is generic', () => {
      const prompts = getFollowUpPrompts({
        lastUserText: 'What just happened?',
        lastAssistantText: 'One replica fell behind in the ZooKeeper queue.',
      })

      expect(prompts[0]).toBe('Show the replication queue')
    })

    test('routes to the rule with the most keyword hits, not the first declared', () => {
      // "per-table" trips the Storage keyword "table", but this is a
      // replication answer through and through (two Replication keyword hits
      // vs. Storage's one) — it must not fall into Storage just because
      // Storage happens to be declared before Replication.
      const prompts = getFollowUpPrompts({
        lastUserText: 'How is replication doing?',
        lastAssistantText:
          'All 3 replicas for the per-table replication queue are in sync.',
      })

      expect(prompts).toEqual([
        'Show the replication queue',
        'Which replica is behind?',
        'Check for a merge backlog',
      ])
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
  })

  describe('cap, dedupe, and edge cases', () => {
    test('respects a smaller limit', () => {
      const prompts = getFollowUpPrompts({
        lastUserText: 'slowest query please',
        lastAssistantText: '',
        limit: 1,
      })

      expect(prompts).toEqual(["Explain the slowest query's plan"])
    })

    test('never returns more than the default cap of 3', () => {
      const prompts = getFollowUpPrompts({
        toolsUsed: ['get_table_parts'],
      })

      expect(prompts.length).toBeLessThanOrEqual(3)
    })

    test('returns an empty array for a zero or negative limit', () => {
      expect(
        getFollowUpPrompts({ lastUserText: 'slow query', limit: 0 })
      ).toEqual([])
      expect(
        getFollowUpPrompts({ lastUserText: 'slow query', limit: -5 })
      ).toEqual([])
    })

    test('never returns duplicate suggestions', () => {
      const prompts = getFollowUpPrompts({
        toolsUsed: ['get_slow_queries', 'get_running_queries'],
        limit: 6,
      })

      expect(new Set(prompts).size).toBe(prompts.length)
    })

    test('handles no arguments at all', () => {
      const prompts = getFollowUpPrompts()
      expect(prompts).toEqual(STARTER_PROMPTS.slice(0, 2).map((p) => p.text))
    })
  })
})
