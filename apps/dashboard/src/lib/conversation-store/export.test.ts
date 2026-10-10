import type { StoredConversation } from './types'

import { exportConversationsJsonl } from './export'
import { MemoryStore } from './memory-store'
import { beforeEach, describe, expect, test } from 'bun:test'

function conv(
  id: string,
  userId: string,
  updatedAt: number
): StoredConversation {
  return {
    id,
    userId,
    title: `t-${id}`,
    messageCount: 1,
    createdAt: 1,
    updatedAt,
    messages: [
      { id: `m-${id}`, role: 'user', parts: [{ type: 'text', text: id }] },
    ],
  }
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const line of gen) out.push(line)
  return out
}

describe('exportConversationsJsonl', () => {
  const store = new MemoryStore()
  beforeEach(() => MemoryStore.clearAll())

  test('empty store yields nothing', async () => {
    expect(await collect(exportConversationsJsonl(store, 'u1'))).toEqual([])
  })

  test('one valid JSON line per conversation with messages intact', async () => {
    await store.upsert(conv('a', 'u1', 10))
    await store.upsert(conv('b', 'u1', 20))
    const lines = await collect(exportConversationsJsonl(store, 'u1'))
    expect(lines).toHaveLength(2)
    for (const l of lines) expect(l.endsWith('\n')).toBe(true)
    const parsed = lines.map((l) => JSON.parse(l) as StoredConversation)
    expect(parsed.map((p) => p.id)).toEqual(['b', 'a'])
    expect(parsed[0].messages[0].parts[0]).toEqual({ type: 'text', text: 'b' })
  })

  test("never includes another user's conversations", async () => {
    await store.upsert(conv('mine', 'u1', 10))
    await store.upsert(conv('theirs', 'u2', 20))
    const parsed = (await collect(exportConversationsJsonl(store, 'u1'))).map(
      (l) => JSON.parse(l) as StoredConversation
    )
    expect(parsed.map((p) => p.id)).toEqual(['mine'])
  })

  test('sinceMs applies the retention cutoff', async () => {
    await store.upsert(conv('old', 'u1', 5))
    await store.upsert(conv('new', 'u1', 50))
    const lines = await collect(
      exportConversationsJsonl(store, 'u1', { sinceMs: 10 })
    )
    expect(lines.map((l) => JSON.parse(l).id)).toEqual(['new'])
  })
})
