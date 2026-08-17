/**
 * Unit tests for {@link AgentStateStore}.
 *
 * The store constructs `new AgentState(...)` internally and catches the SDK's
 * `AgentStateError`, so we mock the entire `@agentstate/sdk` module BEFORE
 * importing the store. The fake `AgentState` records calls and returns
 * controllable values; the fake `AgentStateError` is the SAME class the store
 * imports, so `instanceof` checks in the store resolve correctly.
 *
 * Tests assert only behaviors the source actually implements (verified against
 * agentstate-store.ts).
 */

import type { UIMessage } from 'ai'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Fake AgentStateError matching the real SDK shape (.code / .status). ──
class FakeAgentStateError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'AgentStateError'
    this.code = code
    this.status = status
  }
}

// ── Mutable fake client captured per-test. The store calls `new AgentState()`,
// so we hand back the singleton `fakeClient` regardless of config. ──
type AnyFn = (...args: unknown[]) => unknown

interface Call {
  method: string
  args: unknown[]
}

let calls: Call[] = []
let lastConfig: { apiKey?: string; baseUrl?: string } | undefined

function record(method: string, args: unknown[]): void {
  calls.push({ method, args })
}

function callsTo(method: string): Call[] {
  return calls.filter((c) => c.method === method)
}

// Default implementations — each test overrides as needed.
const impl: Record<string, AnyFn> = {}

const fakeClient = {
  getConversationByExternalId: (...a: unknown[]) =>
    (
      impl.getConversationByExternalId ??
      (() => {
        throw new FakeAgentStateError('not found', 'NOT_FOUND', 404)
      })
    )(...a),
  listConversations: (...a: unknown[]) =>
    (
      impl.listConversations ??
      (() => ({ data: [], pagination: { limit: 100, next_cursor: null } }))
    )(...a),
  createConversation: (...a: unknown[]) =>
    (impl.createConversation ?? (() => ({ id: 'internal-new' })))(...a),
  appendMessages: (...a: unknown[]) =>
    (impl.appendMessages ?? (() => ({ messages: [] })))(...a),
  updateConversation: (...a: unknown[]) =>
    (impl.updateConversation ?? (() => ({})))(...a),
  deleteConversation: (...a: unknown[]) =>
    (impl.deleteConversation ?? (() => undefined))(...a),
  generateTitle: (...a: unknown[]) =>
    (impl.generateTitle ?? (() => ({ title: 'AI Title' })))(...a),
  generateFollowUps: (...a: unknown[]) =>
    (impl.generateFollowUps ?? (() => ({ questions: [] })))(...a),
}

// Wrap every method so calls are recorded.
for (const method of Object.keys(fakeClient)) {
  const original = (fakeClient as Record<string, AnyFn>)[method]
  ;(fakeClient as Record<string, AnyFn>)[method] = (...args: unknown[]) => {
    record(method, args)
    return original(...args)
  }
}

class FakeAgentState {
  constructor(config: { apiKey?: string; baseUrl?: string }) {
    lastConfig = config
  }
}
// Make `new FakeAgentState()` yield the shared fakeClient.
Object.setPrototypeOf(FakeAgentState.prototype, fakeClient)

mock.module('@agentstate/sdk', () => ({
  AgentState: FakeAgentState,
  AgentStateError: FakeAgentStateError,
}))

const { AgentStateStore } = await import('./agentstate-store')
const { ConversationStoreError } = await import('./types')

// ── Helpers ──
function uiMessage(
  id: string,
  role: UIMessage['role'],
  text: string
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
  } as UIMessage
}

function storedConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    userId: 'user-a',
    title: 'My Conversation',
    messageCount: 1,
    createdAt: 1000,
    updatedAt: 2000,
    messages: [uiMessage('m1', 'user', 'Hello')],
    ...overrides,
  } as Parameters<AgentStateStoreType['upsert']>[0]
}

type AgentStateStoreType = InstanceType<typeof AgentStateStore>

beforeEach(() => {
  calls = []
  lastConfig = undefined
  for (const k of Object.keys(impl)) delete impl[k]
})

// ============================================================================
// constructor + config
// ============================================================================
describe('constructor', () => {
  test('passes apiKey and default baseUrl to AgentState', () => {
    new AgentStateStore({ apiKey: 'as_live_key' })
    expect(lastConfig?.apiKey).toBe('as_live_key')
    expect(lastConfig?.baseUrl).toBe('https://agentstate.app/api')
  })

  test('throws ConversationStoreError VALIDATION_ERROR when apiKey missing', () => {
    expect(() => new AgentStateStore({ apiKey: '' })).toThrow(
      ConversationStoreError
    )
    try {
      new AgentStateStore({ apiKey: '' })
    } catch (err) {
      expect((err as InstanceType<typeof ConversationStoreError>).code).toBe(
        'VALIDATION_ERROR'
      )
    }
  })

  test('honors custom baseUrl', () => {
    new AgentStateStore({ apiKey: 'k', baseUrl: 'https://example.test/api' })
    expect(lastConfig?.baseUrl).toBe('https://example.test/api')
  })
})

// ============================================================================
// upsert → create
// ============================================================================
describe('upsert (create path)', () => {
  test('creates with deterministic external_id, metadata, and mapped messages', async () => {
    impl.getConversationByExternalId = () => {
      throw new FakeAgentStateError('missing', 'NOT_FOUND', 404)
    }
    let createArg: Record<string, unknown> | undefined
    impl.createConversation = (arg: unknown) => {
      createArg = arg as Record<string, unknown>
      return { id: 'internal-1' }
    }

    const store = new AgentStateStore({ apiKey: 'k' })
    await store.upsert(
      storedConversation({
        id: 'conv-x',
        userId: 'user-z',
        model: 'gpt-4',
        hostId: 3,
        messages: [
          uiMessage('m1', 'user', 'Hello '),
          uiMessage('m2', 'assistant', 'World'),
        ],
      })
    )

    expect(createArg?.external_id).toBe('user-z:conv-x')
    const meta = createArg?.metadata as Record<string, unknown>
    expect(meta.userId).toBe('user-z')
    expect(meta.app).toBe('clickhouse-monitoring')
    expect(meta.model).toBe('gpt-4')
    expect(meta.hostId).toBe(3)
    expect(meta.tags).toEqual(['user:user-z'])

    const messages = createArg?.messages as Array<Record<string, unknown>>
    expect(messages).toHaveLength(2)
    // content is the joined text of text parts.
    expect(messages[0].content).toBe('Hello ')
    expect(messages[0].role).toBe('user')
    // Full UIMessage preserved under metadata.ui, with uiId for diffing.
    const m0meta = messages[0].metadata as Record<string, unknown>
    expect((m0meta.ui as UIMessage).id).toBe('m1')
    expect(m0meta.uiId).toBe('m1')

    // No append/update on the create path.
    expect(callsTo('appendMessages')).toHaveLength(0)
    expect(callsTo('updateConversation')).toHaveLength(0)
  })

  test('empty text content falls back to a single space (min length 1)', async () => {
    impl.getConversationByExternalId = () => {
      throw new FakeAgentStateError('missing', 'NOT_FOUND', 404)
    }
    let createArg: Record<string, unknown> | undefined
    impl.createConversation = (arg: unknown) => {
      createArg = arg as Record<string, unknown>
      return { id: 'internal-1' }
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await store.upsert(
      storedConversation({
        messages: [{ id: 'm1', role: 'user', parts: [] } as UIMessage],
      })
    )
    const messages = createArg?.messages as Array<Record<string, unknown>>
    expect(messages[0].content).toBe(' ')
  })
})

// ============================================================================
// upsert → append-only diff
// ============================================================================
describe('upsert (append-only diff path)', () => {
  test('appends only NEW messages (by metadata.uiId) and updates conversation', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-7',
      external_id: 'user-a:conv-1',
      title: 'Old',
      metadata: { userId: 'user-a' },
      message_count: 1,
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          id: 'agent-msg-1',
          role: 'user',
          content: 'Hello',
          metadata: { uiId: 'm1' },
        },
      ],
    })
    let appendArgs: unknown[] | undefined
    impl.appendMessages = (...a: unknown[]) => {
      appendArgs = a
      return { messages: [] }
    }
    let updateArgs: unknown[] | undefined
    impl.updateConversation = (...a: unknown[]) => {
      updateArgs = a
      return {}
    }

    const store = new AgentStateStore({ apiKey: 'k' })
    await store.upsert(
      storedConversation({
        title: 'Updated Title',
        messages: [
          uiMessage('m1', 'user', 'Hello'), // already stored
          uiMessage('m2', 'assistant', 'New reply'), // new
        ],
      })
    )

    // createConversation must NOT be called when one exists.
    expect(callsTo('createConversation')).toHaveLength(0)

    // Append targets the internal id and only the new message.
    expect(appendArgs?.[0]).toBe('internal-7')
    const appended = appendArgs?.[1] as Array<Record<string, unknown>>
    expect(appended).toHaveLength(1)
    expect((appended[0].metadata as Record<string, unknown>).uiId).toBe('m2')

    // updateConversation is called with new title + metadata.
    expect(updateArgs?.[0]).toBe('internal-7')
    const updatePayload = updateArgs?.[1] as Record<string, unknown>
    expect(updatePayload.title).toBe('Updated Title')
    expect((updatePayload.metadata as Record<string, unknown>).userId).toBe(
      'user-a'
    )
  })

  test('does not call appendMessages when there are no new messages', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-7',
      external_id: 'user-a:conv-1',
      title: 'Old',
      metadata: { userId: 'user-a' },
      message_count: 1,
      created_at: 1,
      updated_at: 2,
      messages: [
        {
          id: 'agent-msg-1',
          role: 'user',
          content: 'Hello',
          metadata: { uiId: 'm1' },
        },
      ],
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    await store.upsert(
      storedConversation({ messages: [uiMessage('m1', 'user', 'Hello')] })
    )
    expect(callsTo('appendMessages')).toHaveLength(0)
    // updateConversation is still called.
    expect(callsTo('updateConversation')).toHaveLength(1)
  })
})

// ============================================================================
// get
// ============================================================================
describe('get', () => {
  test('maps result to StoredConversation, reconstructing UIMessages from metadata.ui', async () => {
    const richUi = uiMessage('m1', 'assistant', 'Hi')
    impl.getConversationByExternalId = () => ({
      id: 'internal-1',
      external_id: 'user-a:conv-1',
      title: 'A Title',
      metadata: { userId: 'user-a', model: 'gpt-4', hostId: 2 },
      message_count: 1,
      created_at: 111,
      updated_at: 222,
      messages: [
        {
          id: 'agent-1',
          role: 'assistant',
          content: 'Hi',
          metadata: { ui: richUi, uiId: 'm1' },
        },
      ],
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    const result = await store.get('user-a', 'conv-1')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('conv-1')
    expect(result?.title).toBe('A Title')
    expect(result?.model).toBe('gpt-4')
    expect(result?.hostId).toBe(2)
    expect(result?.createdAt).toBe(111)
    expect(result?.messages).toHaveLength(1)
    // Reconstructed exact UIMessage from metadata.ui.
    expect(result?.messages[0].id).toBe('m1')
    expect(result?.messages[0]).toEqual(richUi)
  })

  test('falls back to a text part when metadata.ui is absent', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-1',
      external_id: 'user-a:conv-1',
      title: 'T',
      metadata: { userId: 'user-a' },
      message_count: 1,
      created_at: 1,
      updated_at: 2,
      messages: [
        { id: 'agent-1', role: 'user', content: 'plain text', metadata: {} },
      ],
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    const result = await store.get('user-a', 'conv-1')
    const msg = result?.messages[0]
    expect(msg?.role).toBe('user')
    expect(msg?.parts).toEqual([{ type: 'text', text: 'plain text' }])
  })

  test('returns null on 404 (NOT_FOUND)', async () => {
    impl.getConversationByExternalId = () => {
      throw new FakeAgentStateError('missing', 'NOT_FOUND', 404)
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    expect(await store.get('user-a', 'conv-1')).toBeNull()
  })

  test('returns null when metadata.userId !== userId (isolation)', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-1',
      external_id: 'other:conv-1',
      title: 'T',
      metadata: { userId: 'someone-else' },
      message_count: 0,
      created_at: 1,
      updated_at: 2,
      messages: [],
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    expect(await store.get('user-a', 'conv-1')).toBeNull()
  })
})

// ============================================================================
// list
// ============================================================================
describe('list', () => {
  function conv(id: string, userId: string, extId: string) {
    return {
      id,
      external_id: extId,
      title: `title-${id}`,
      metadata: { userId },
      message_count: 0,
      created_at: 1,
      updated_at: 2,
    }
  }

  test('filters to conversations whose metadata.userId matches and maps to ConversationMeta', async () => {
    impl.listConversations = () => ({
      data: [
        conv('a', 'user-a', 'user-a:conv-a'),
        conv('b', 'other', 'other:conv-b'),
        conv('c', 'user-a', 'user-a:conv-c'),
      ],
      pagination: { limit: 100, next_cursor: null },
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    const result = await store.list('user-a')
    expect(result).toHaveLength(2)
    // conversation id is derived from external_id (prefix stripped).
    expect(result.map((r) => r.id)).toEqual(['conv-a', 'conv-c'])
    expect(result[0].userId).toBe('user-a')
    expect(result[0].title).toBe('title-a')
  })

  test('respects the limit', async () => {
    impl.listConversations = () => ({
      data: [
        conv('a', 'user-a', 'user-a:conv-a'),
        conv('b', 'user-a', 'user-a:conv-b'),
        conv('c', 'user-a', 'user-a:conv-c'),
      ],
      pagination: { limit: 100, next_cursor: null },
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    const result = await store.list('user-a', 2)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id)).toEqual(['conv-a', 'conv-b'])
  })

  test('paginates using pagination.next_cursor', async () => {
    let page = 0
    const cursors: (string | undefined)[] = []
    impl.listConversations = (params: unknown) => {
      cursors.push((params as { cursor?: string }).cursor)
      page += 1
      if (page === 1) {
        return {
          data: [conv('a', 'user-a', 'user-a:conv-a')],
          pagination: { limit: 100, next_cursor: 'cursor-2' },
        }
      }
      return {
        data: [conv('b', 'user-a', 'user-a:conv-b')],
        pagination: { limit: 100, next_cursor: null },
      }
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    const result = await store.list('user-a', 50)
    expect(result.map((r) => r.id)).toEqual(['conv-a', 'conv-b'])
    // First call no cursor, second call uses next_cursor.
    expect(cursors[0]).toBeUndefined()
    expect(cursors[1]).toBe('cursor-2')
  })

  test('still returns a user conversation buried under >500 newer ones from others (regression)', async () => {
    // 6 pages of 100. Pages 1-5 are all from other users (500 conversations);
    // the target user's conversations only appear on page 6. The previous
    // 5-page (500-conversation) cap dropped them entirely.
    const totalPages = 6
    let page = 0
    impl.listConversations = () => {
      page += 1
      const isLast = page === totalPages
      const data = isLast
        ? [
            conv('mine-1', 'user-a', 'user-a:mine-1'),
            conv('mine-2', 'user-a', 'user-a:mine-2'),
          ]
        : Array.from({ length: 100 }, (_, i) =>
            conv(`other-${page}-${i}`, 'other', `other:other-${page}-${i}`)
          )
      return {
        data,
        pagination: {
          limit: 100,
          next_cursor: isLast ? null : `cursor-${page + 1}`,
        },
      }
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    const result = await store.list('user-a')
    expect(result.map((r) => r.id)).toEqual(['mine-1', 'mine-2'])
  })

  test('bounds the scan so a never-matching user terminates (cap = 5000 scanned)', async () => {
    let calls = 0
    impl.listConversations = () => {
      calls += 1
      return {
        data: Array.from({ length: 100 }, (_, i) =>
          conv(`o-${calls}-${i}`, 'other', `other:o-${calls}-${i}`)
        ),
        // next_cursor never null: without the scan cap this would loop forever.
        pagination: { limit: 100, next_cursor: `cursor-${calls + 1}` },
      }
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    const result = await store.list('nobody')
    expect(result).toEqual([])
    // 5000 scan budget / 100 per page = 50 pages, then it stops.
    expect(calls).toBe(50)
  })
})

// ============================================================================
// delete / deleteAll
// ============================================================================
describe('delete', () => {
  test('resolves internal id then calls deleteConversation', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-9',
      external_id: 'user-a:conv-1',
      title: 'T',
      metadata: { userId: 'user-a' },
      message_count: 0,
      created_at: 1,
      updated_at: 2,
      messages: [],
    })
    let deletedId: unknown
    impl.deleteConversation = (id: unknown) => {
      deletedId = id
      return undefined
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await store.delete('user-a', 'conv-1')
    expect(deletedId).toBe('internal-9')
  })

  test('no-op when conversation missing (404)', async () => {
    impl.getConversationByExternalId = () => {
      throw new FakeAgentStateError('missing', 'NOT_FOUND', 404)
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await store.delete('user-a', 'conv-1')
    expect(callsTo('deleteConversation')).toHaveLength(0)
  })

  test('no-op when conversation owned by another user', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-9',
      external_id: 'other:conv-1',
      title: 'T',
      metadata: { userId: 'other' },
      message_count: 0,
      created_at: 1,
      updated_at: 2,
      messages: [],
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    await store.delete('user-a', 'conv-1')
    expect(callsTo('deleteConversation')).toHaveLength(0)
  })
})

describe('deleteAll', () => {
  test("iterates the user's conversations and deletes each owned one", async () => {
    impl.listConversations = () => ({
      data: [
        {
          id: 'internal-a',
          external_id: 'user-a:conv-a',
          metadata: { userId: 'user-a' },
          title: null,
          message_count: 0,
          created_at: 1,
          updated_at: 2,
        },
        {
          id: 'internal-b',
          external_id: 'other:conv-b',
          metadata: { userId: 'other' },
          title: null,
          message_count: 0,
          created_at: 1,
          updated_at: 2,
        },
        {
          id: 'internal-c',
          external_id: 'user-a:conv-c',
          metadata: { userId: 'user-a' },
          title: null,
          message_count: 0,
          created_at: 1,
          updated_at: 2,
        },
      ],
      pagination: { limit: 100, next_cursor: null },
    })
    const deleted: unknown[] = []
    impl.deleteConversation = (id: unknown) => {
      deleted.push(id)
      return undefined
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await store.deleteAll('user-a')
    expect(deleted).toEqual(['internal-a', 'internal-c'])
  })
})

// ============================================================================
// AI enrichment
// ============================================================================
describe('AI enrichment', () => {
  function existingNone() {
    impl.getConversationByExternalId = () => {
      throw new FakeAgentStateError('missing', 'NOT_FOUND', 404)
    }
    impl.createConversation = () => ({ id: 'internal-1' })
  }

  test('calls generateTitle when aiEnrich and title is generic, with user+assistant messages', async () => {
    existingNone()
    const store = new AgentStateStore({ apiKey: 'k', aiEnrich: true })
    await store.upsert(
      storedConversation({
        title: 'New Conversation',
        messages: [
          uiMessage('m1', 'user', 'hi'),
          uiMessage('m2', 'assistant', 'hello'),
        ],
      })
    )
    expect(callsTo('generateTitle')).toHaveLength(1)
    expect(callsTo('generateTitle')[0].args[0]).toBe('internal-1')
    expect(callsTo('updateConversation')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: ['internal-1', { title: 'AI Title' }],
        }),
      ])
    )
  })

  test('calls generateTitle when title is New Chat and persists the result', async () => {
    existingNone()
    const store = new AgentStateStore({ apiKey: 'k', aiEnrich: true })
    await store.upsert(
      storedConversation({
        title: 'New Chat',
        messages: [
          uiMessage('m1', 'user', 'hi'),
          uiMessage('m2', 'assistant', 'hello'),
        ],
      })
    )
    expect(callsTo('generateTitle')).toHaveLength(1)
    expect(callsTo('updateConversation')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: ['internal-1', { title: 'AI Title' }],
        }),
      ])
    )
  })

  test('does NOT call generateTitle when aiEnrich is false', async () => {
    existingNone()
    const store = new AgentStateStore({ apiKey: 'k', aiEnrich: false })
    await store.upsert(
      storedConversation({
        title: 'New Conversation',
        messages: [
          uiMessage('m1', 'user', 'hi'),
          uiMessage('m2', 'assistant', 'hello'),
        ],
      })
    )
    expect(callsTo('generateTitle')).toHaveLength(0)
  })

  test('does NOT call generateTitle when title is not generic', async () => {
    existingNone()
    const store = new AgentStateStore({ apiKey: 'k', aiEnrich: true })
    await store.upsert(
      storedConversation({
        title: 'A Specific Title',
        messages: [
          uiMessage('m1', 'user', 'hi'),
          uiMessage('m2', 'assistant', 'hello'),
        ],
      })
    )
    expect(callsTo('generateTitle')).toHaveLength(0)
  })

  test('does NOT call generateTitle without both user and assistant messages', async () => {
    existingNone()
    const store = new AgentStateStore({ apiKey: 'k', aiEnrich: true })
    await store.upsert(
      storedConversation({
        title: 'New Conversation',
        messages: [uiMessage('m1', 'user', 'hi')],
      })
    )
    expect(callsTo('generateTitle')).toHaveLength(0)
  })

  test('a thrown error from generateTitle does NOT fail the upsert', async () => {
    existingNone()
    impl.generateTitle = () => {
      throw new Error('title boom')
    }
    const store = new AgentStateStore({ apiKey: 'k', aiEnrich: true })
    // Should resolve without throwing.
    await store.upsert(
      storedConversation({
        title: 'New Conversation',
        messages: [
          uiMessage('m1', 'user', 'hi'),
          uiMessage('m2', 'assistant', 'hello'),
        ],
      })
    )
    expect(callsTo('generateTitle')).toHaveLength(1)
  })
})

// ============================================================================
// followUps
// ============================================================================
describe('followUps', () => {
  test('returns generateFollowUps().questions', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-1',
      external_id: 'user-a:conv-1',
      title: 'T',
      metadata: { userId: 'user-a' },
      message_count: 0,
      created_at: 1,
      updated_at: 2,
      messages: [],
    })
    impl.generateFollowUps = (id: unknown) => {
      expect(id).toBe('internal-1')
      return { questions: ['Q1', 'Q2'] }
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    const questions = await store.followUps('user-a', 'conv-1')
    expect(questions).toEqual(['Q1', 'Q2'])
  })

  test('throws ConversationStoreError NOT_FOUND when conversation missing', async () => {
    impl.getConversationByExternalId = () => {
      throw new FakeAgentStateError('missing', 'NOT_FOUND', 404)
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await expect(store.followUps('user-a', 'conv-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  test('throws NOT_FOUND when conversation owned by another user', async () => {
    impl.getConversationByExternalId = () => ({
      id: 'internal-1',
      external_id: 'other:conv-1',
      title: 'T',
      metadata: { userId: 'other' },
      message_count: 0,
      created_at: 1,
      updated_at: 2,
      messages: [],
    })
    const store = new AgentStateStore({ apiKey: 'k' })
    await expect(store.followUps('user-a', 'conv-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

// ============================================================================
// error mapping (via wrap)
// ============================================================================
describe('error mapping', () => {
  test('AgentStateError status 401 → UNAUTHORIZED', async () => {
    impl.listConversations = () => {
      throw new FakeAgentStateError('unauth', 'UNAUTHORIZED', 401)
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await expect(store.list('user-a')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  test('AgentStateError status 403 → UNAUTHORIZED', async () => {
    impl.listConversations = () => {
      throw new FakeAgentStateError('forbidden', 'FORBIDDEN', 403)
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await expect(store.list('user-a')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })

  test('AgentStateError status 400 → VALIDATION_ERROR', async () => {
    impl.listConversations = () => {
      throw new FakeAgentStateError('bad', 'BAD_REQUEST', 400)
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await expect(store.list('user-a')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  test('other AgentStateError → STORAGE_ERROR', async () => {
    impl.listConversations = () => {
      throw new FakeAgentStateError('boom', 'INTERNAL', 500)
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await expect(store.list('user-a')).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    })
  })

  test('non-AgentStateError → STORAGE_ERROR', async () => {
    impl.listConversations = () => {
      throw new Error('plain failure')
    }
    const store = new AgentStateStore({ apiKey: 'k' })
    await expect(store.list('user-a')).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    })
  })
})
