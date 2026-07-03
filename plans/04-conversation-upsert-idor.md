# Plan 04: Scope the conversation upsert so a PUT/POST cannot overwrite or seize another user's conversation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/lib/conversation-store apps/dashboard/src/routes/api/v1/conversations`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

The conversation store's write path is a cross-tenant IDOR. `PUT /api/v1/conversations/$id`
authorizes with a **user-scoped read** (`store.get(userId, id)`) but then does an
**unscoped upsert** whose SQL is `ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, …`
— conflict key is `id` alone and the update reassigns ownership to the caller. So an
authenticated user who PUTs another user's conversation `id` overwrites that row's
`title`/`messages` **and takes ownership of it** — the victim loses the conversation
and its content is replaced. This affects the **D1** and **Postgres** backends (both
first-class in `resolve-store.ts`); the AgentState backend is namespaced-safe and OSS
single-user mode collapses everyone to `guest` (unaffected). Random-UUID ids are a
mitigation, not a control (they leak via shared links, logs, referrers). The fix makes
the write enforce ownership like the read already does.

## Current state

Files:
- `apps/dashboard/src/lib/conversation-store/d1-store.ts` — D1 (Cloudflare) backend. Vulnerable upsert.
- `apps/dashboard/src/lib/conversation-store/postgres-store.ts` — Postgres (Node) backend. Vulnerable upsert.
- `apps/dashboard/src/lib/conversation-store/memory-store.ts` — in-memory reference impl (used in tests). Fix here too so it can carry the regression test.
- `apps/dashboard/src/lib/conversation-store/agentstate-store.ts` — namespaced-safe backend; only needs the return-type change.
- `apps/dashboard/src/lib/conversation-store/browser-store.ts` — client-side localStorage, single-user; only needs the return-type change.
- `apps/dashboard/src/lib/conversation-store/types.ts` — the `ConversationStore` interface (`:221`), `upsert` signature (`:240`).
- `apps/dashboard/src/routes/api/v1/conversations/$id.ts` — `handlePut` (create-or-update). Caller at `:295`.
- `apps/dashboard/src/routes/api/v1/conversations.ts` — `handlePost` (create). Caller at `:281`.

The vulnerable D1 SQL (`d1-store.ts:203-224`):

```ts
const stmt = db.prepare(
  `INSERT INTO conversations (id, user_id, title, messages, message_count, created_at, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
   ON CONFLICT (id) DO UPDATE SET
     user_id = excluded.user_id,          -- ⚠ reassigns ownership
     title = excluded.title,
     messages = excluded.messages,
     message_count = excluded.message_count,
     updated_at = excluded.updated_at`     -- ⚠ no ownership guard on the update
).bind(conversation.id, conversation.userId, conversation.title, messagesJson,
       conversation.messageCount, conversation.createdAt, conversation.updatedAt)
await stmt.run()
```

The identical Postgres flaw (`postgres-store.ts:271-290`) uses `EXCLUDED.user_id` and the same `ON CONFLICT (id)`.

The route that discards its own auth check (`conversations/$id.ts:277-295`):

```ts
const store = await resolveStore()
const existingConversation = await store.get(userId, id)   // scoped read — returns null for a foreign row
// Build create-or-update conversation (needed for localStorage migration PUT uploads)
const updatedConversation: StoredConversation = { id, userId /* caller */, title: …, messages: …, … }
await store.upsert(updatedConversation)                    // ⚠ unconditional; ignores the scoped read
```

Conventions to match:
- `userId` comes from `resolveUserId()` (`$id.ts:228`) — real per-user under Clerk, `'guest'` in OSS.
- Error responses use `createApiErrorResponse({ type: ApiErrorType.X, message, details:{timestamp} }, <status>, ROUTE_CONTEXT_PUT)` — see `$id.ts:236-244` for the exact shape. Reuse it; do not invent a new error helper.
- The store interface returns typed results; keep `StoredConversation` unchanged.
- Tests use **Bun test** (`bun:test`) — see `apps/dashboard/src/lib/conversation-store/memory-store.test.ts` for the exact structure to mirror. Do NOT add Jest.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0, no errors |
| Unit test (store) | `cd apps/dashboard && bun test src/lib/conversation-store --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |
| Grep guard | `rg -n "user_id = excluded.user_id\|user_id = EXCLUDED.user_id" apps/dashboard/src/lib/conversation-store` | no matches after fix |

## Scope

**In scope** (the only files you may modify):
- `apps/dashboard/src/lib/conversation-store/d1-store.ts`
- `apps/dashboard/src/lib/conversation-store/postgres-store.ts`
- `apps/dashboard/src/lib/conversation-store/memory-store.ts`
- `apps/dashboard/src/lib/conversation-store/agentstate-store.ts`
- `apps/dashboard/src/lib/conversation-store/browser-store.ts`
- `apps/dashboard/src/lib/conversation-store/types.ts`
- `apps/dashboard/src/routes/api/v1/conversations/$id.ts`
- `apps/dashboard/src/routes/api/v1/conversations.ts`
- `apps/dashboard/src/lib/conversation-store/memory-store.test.ts` (extend)
- `apps/dashboard/src/lib/conversation-store/d1-store.sql.test.ts` (create — runs the real SQL via `bun:sqlite`)

**Out of scope** (do NOT touch):
- The `StoredConversation` type / DB schema / migration SQL — the fix is query-level, no schema change.
- The `get`/`delete` methods — already correctly scoped (`WHERE id=? AND user_id=?`).
- Any other route or the AgentState key-namespacing logic beyond adapting the return type.

## Git workflow

- Branch: `advisor/04-conversation-upsert-idor`
- Conventional commits; include `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `fix(conversations): scope upsert to owner to close cross-tenant IDOR`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Close the D1 hole (security-critical — this alone stops the takeover)

In `d1-store.ts` `upsert`: **(1) extract** the full `INSERT … ON CONFLICT …`
statement into an exported module constant so the Step 4b test can run the exact
string — `export const D1_UPSERT_CONVERSATION_SQL = \`…\`` — and pass it to
`db.prepare(D1_UPSERT_CONVERSATION_SQL)`. **(2)** change the `ON CONFLICT` clause to
**remove** the `user_id = excluded.user_id` line and add a trailing `WHERE` guard so
a row owned by someone else is never updated:

```sql
ON CONFLICT (id) DO UPDATE SET
  title = excluded.title,
  messages = excluded.messages,
  message_count = excluded.message_count,
  updated_at = excluded.updated_at
WHERE conversations.user_id = excluded.user_id
```

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0.

### Step 2: Close the Postgres hole identically

In `postgres-store.ts` `upsert`, remove `user_id = EXCLUDED.user_id` and append
`WHERE conversations.user_id = EXCLUDED.user_id` to the `DO UPDATE`.

**Verify**: `rg -n "user_id = excluded.user_id|user_id = EXCLUDED.user_id" apps/dashboard/src/lib/conversation-store` → **no matches**.

### Step 3: Make `upsert` report whether it wrote a row (fail-loud plumbing)

The DB guard now makes a foreign-owned PUT a silent no-op. To fail loud instead of
returning a misleading `200`, surface a written/not-written signal. This step is
**atomic** — change the interface and ALL six impls and BOTH callers together, or the
build breaks.

1. `types.ts:240` — change `upsert(conversation: StoredConversation): Promise<void>` to
   `upsert(conversation: StoredConversation): Promise<{ written: boolean }>`.
2. `d1-store.ts` — `const res = await stmt.run(); return { written: (res.meta?.changes ?? 0) > 0 }`
   (SQLite `changes()` is 0 when the `DO UPDATE … WHERE` guard fails).
3. `postgres-store.ts` — capture the result of the tagged-template query
   (`const res = await this.sql\`…\``) and `return { written: res.count > 0 }`
   (`postgres.js` exposes `.count` = rows affected).
4. `memory-store.ts` — see Step 4 (add the owner guard there, return `{ written }`).
5. `agentstate-store.ts` and `browser-store.ts` — these are namespaced-safe / single-user;
   after their existing write, `return { written: true }`.

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0 (this proves all impls + callers were updated).

### Step 4: Give the in-memory reference impl the same ownership semantics + a regression test

`memory-store.ts` `upsert` uses a `Map`. Add the owner guard so it matches production
semantics and can be tested without a live DB: if a conversation with `conversation.id`
already exists under a **different** `userId`, do NOT overwrite it — `return { written: false }`.
Otherwise write and `return { written: true }`.

**Verify**: `cd apps/dashboard && bun test src/lib/conversation-store/memory-store.test.ts --isolate` → all pass (including the new cases from the Test plan).

### Step 4b: Prove the REAL D1 SQL enforces ownership (bun:sqlite — the security gate)

`memory-store` is a `Map` and exercises **none** of the actual fix — the
`WHERE … = excluded.user_id` guard and the `changes === 0` semantics that the
`written` flag depends on live only in the SQL string. Test that string directly
against in-memory SQLite (SQLite **is** D1's engine), so the fix is actually executed.
Create `d1-store.sql.test.ts`:

```ts
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { D1_UPSERT_CONVERSATION_SQL } from './d1-store' // exported in Step 1

function seed() {
  const db = new Database(':memory:')
  // PK is `id` alone — mirror db/conversations-migrations/0001_conversations.sql
  db.run(`CREATE TABLE conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, messages TEXT,
    message_count INTEGER, created_at INTEGER, updated_at INTEGER)`)
  db.run(`INSERT INTO conversations VALUES ('c1','u1','orig','[1]',1,1,1)`)
  return db
}
// Bind order must match the ?1..?7 order in the SQL:
// (id, user_id, title, messages, message_count, created_at, updated_at)

describe('d1 upsert ownership guard (real SQL)', () => {
  test('a foreign owner cannot overwrite/seize the row; changes === 0', () => {
    const db = seed()
    const res = db.query(D1_UPSERT_CONVERSATION_SQL).run('c1','u2','hijacked','[]',0,2,2)
    expect(res.changes).toBe(0)                    // guard blocked the update
    const row = db.query(`SELECT user_id, title, messages FROM conversations WHERE id='c1'`).get() as any
    expect(row.user_id).toBe('u1')                 // ownership intact
    expect(row.title).toBe('orig')                 // content intact
    expect(row.messages).toBe('[1]')
  })
  test('the owner can update; changes === 1', () => {
    const db = seed()
    const res = db.query(D1_UPSERT_CONVERSATION_SQL).run('c1','u1','new','[1,2]',2,1,3)
    expect(res.changes).toBe(1)
    expect((db.query(`SELECT title FROM conversations WHERE id='c1'`).get() as any).title).toBe('new')
  })
  test('a new id inserts; changes === 1', () => {
    const db = seed()
    expect(db.query(D1_UPSERT_CONVERSATION_SQL).run('c2','u2','x','[]',0,4,4).changes).toBe(1)
  })
})
```

If `?1`-style numbered binding doesn't accept positional `.run(...)` args in this
`bun:sqlite` version, bind by object (`{ 1: 'c1', 2: 'u2', … }`) or match the SQL's
param style — do NOT change the production SQL to suit the test.

**Verify**: `cd apps/dashboard && bun test src/lib/conversation-store/d1-store.sql.test.ts --isolate` → all pass; the foreign-owner test proves `changes === 0` and the victim row is byte-for-byte unchanged.

### Step 5: Fail loud in the routes

- `conversations/$id.ts` `handlePut` (`:295`): change to
  `const { written } = await store.upsert(updatedConversation)` and, when
  `!written && existingConversation === null`, return a **409** with
  `ApiErrorType.ValidationError` (or a Conflict type if one exists) and message
  `'Conversation ID belongs to another user.'` — reusing the `createApiErrorResponse`
  shape at `$id.ts:236-244`. When `existingConversation` was non-null the write always
  succeeds (owned update), so the existing 200 path is unchanged.
- `conversations.ts` `handlePost` (`:281`): adapt to the new return type. If this route
  mints a fresh server-side id, `written` is always true; still handle `!written` by
  returning a 409 (unexpected id collision) rather than a misleading 200.

**Verify**: `cd apps/dashboard && bun run build` → exit 0, and `bun run lint` → exit 0.

## Test plan

Extend `apps/dashboard/src/lib/conversation-store/memory-store.test.ts` (mirror its existing `describe`/`test` structure):

1. **owner update** — `upsert({id:'c1', userId:'u1', …})` then `upsert({id:'c1', userId:'u1', title:'new'})` → second returns `{written:true}`; `get('u1','c1').title === 'new'`.
2. **foreign write blocked (the regression test for this IDOR)** — `upsert({id:'c1', userId:'u1', title:'orig', messages:[…]})`, then `upsert({id:'c1', userId:'u2', title:'hijacked', messages:[]})` → returns `{written:false}`; `get('u1','c1')` still has `title:'orig'`, original messages, and `userId:'u1'` (unchanged); `get('u2','c1')` returns `null`.
3. **new id** — `upsert({id:'c2', userId:'u2', …})` → `{written:true}`; retrievable by `u2`.

**Plus the real-SQL gate** (`d1-store.sql.test.ts`, Step 4b): the production
`D1_UPSERT_CONVERSATION_SQL` run under `bun:sqlite` proves a foreign-owner PUT yields
`changes === 0` and leaves the victim's row intact. This — not the memory-store test —
is what proves the security fix actually works; the memory-store test only locks the
reference-impl semantics. (Postgres shares the identical guard pattern and is verified by
review + type-check; SQLite is the semantic anchor.)

Verification: `cd apps/dashboard && bun test src/lib/conversation-store --isolate` → all pass, including the new memory-store cases and the `d1-store.sql.test.ts` gate.

## Done criteria

ALL must hold:
- [ ] `cd apps/dashboard && bun run type-check` exits 0
- [ ] `cd apps/dashboard && bun test src/lib/conversation-store --isolate` passes, including the memory-store "foreign write blocked" test AND the `d1-store.sql.test.ts` real-SQL gate
- [ ] `d1-store.sql.test.ts` runs `D1_UPSERT_CONVERSATION_SQL` under `bun:sqlite` and asserts the foreign-owner case yields `changes === 0` with the victim's row unchanged
- [ ] `rg -n "user_id = excluded.user_id|user_id = EXCLUDED.user_id" apps/dashboard/src/lib/conversation-store` returns no matches
- [ ] `cd apps/dashboard && bun run build` exits 0
- [ ] `bun run lint` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:
- The `ON CONFLICT (id) DO UPDATE` excerpts don't match the live D1/Postgres code (drift).
- Changing `upsert`'s return type reveals a **caller not listed** in Scope (more than the two routes + six impls).
- The `d1-store.sql.test.ts` gate shows the guarded foreign-owner upsert does **NOT** yield `changes === 0` (i.e. the `DO UPDATE … WHERE` guard doesn't behave as expected in SQLite/D1) — STOP and report; the whole `written`→409 design rests on this, and shipping without it re-opens the IDOR.
- `res.meta?.changes` is not available on the live D1 result object in the Worker runtime (the `bun:sqlite` test proves the SQL, but the impl reads `changes` off the real D1 result — confirm the field name).
- `postgres.js`'s result has no `.count` field in the installed version.

## Maintenance notes

- Reviewer: confirm the `WHERE … = excluded.user_id` guard is present on **both** SQL backends and that `user_id` is never in a `SET` list again.
- If a future feature legitimately transfers conversation ownership, it must be an explicit, separately-authorized operation — never a side effect of `upsert`.
- The security fix is proven by `d1-store.sql.test.ts` (real SQL under `bun:sqlite`); `memory-store.test.ts` only locks the reference-impl semantics. Postgres shares the guard pattern but isn't dialect-testable with `bun:sqlite` — if a Postgres integration harness is added later, port the foreign-owner case there too.
