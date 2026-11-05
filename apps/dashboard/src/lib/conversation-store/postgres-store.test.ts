import { PostgresStore } from './postgres-store'
import { describe, expect, test } from 'bun:test'

const MESSAGES = [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
]

function storeWithMessages(messages: unknown): PostgresStore {
  const store = new PostgresStore('postgres://u:p@localhost:5432/db')
  const row = {
    id: 'c1',
    user_id: 'u1',
    title: 't',
    messages,
    message_count: 2,
    created_at: 1,
    updated_at: 2,
  }
  const stub = () => Promise.resolve([row])
  const internals = store as unknown as { sql: unknown; initialized: boolean }
  internals.sql = stub
  internals.initialized = true
  return store
}

describe('PostgresStore.get messages column', () => {
  test('accepts an already parsed array', async () => {
    const conv = await storeWithMessages(MESSAGES).get('u1', 'c1')
    expect(conv?.messages).toEqual(MESSAGES as never)
  })

  test('accepts a JSON string (servers that skip JSONB parsing)', async () => {
    const conv = await storeWithMessages(JSON.stringify(MESSAGES)).get(
      'u1',
      'c1'
    )
    expect(conv?.messages).toEqual(MESSAGES as never)
  })

  test('drops entries that are not messages', async () => {
    const conv = await storeWithMessages(
      JSON.stringify([...MESSAGES, null, 3, { foo: 1 }])
    ).get('u1', 'c1')
    expect(conv?.messages).toHaveLength(2)
  })

  test('malformed JSON fails with a clear store error', async () => {
    await expect(storeWithMessages('{oops').get('u1', 'c1')).rejects.toThrow(
      'messages column is not valid JSON'
    )
  })

  test('non-array fails with a clear store error', async () => {
    await expect(storeWithMessages({ a: 1 }).get('u1', 'c1')).rejects.toThrow(
      'messages column is not a JSON array'
    )
  })
})
