# Plan 87: Fix addConnection stale return and the first-run device-key race

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/hooks/use-browser-connections.ts apps/dashboard/src/lib/connection-crypto`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches crypto-at-rest for stored connections)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2504

## Why this matters

Two defects in browser-stored connections (client-side encrypted ClickHouse
credentials):

1. **Wrong-host navigation**: `addConnection` computes the new connection's
   (negative) hostId *inside* the `setConnections` state updater and returns a
   variable reassigned there. React doesn't guarantee the updater runs before
   the return, so callers can receive the placeholder with `hostId: 0` — and
   `add-host-dialog.tsx` navigates to `?host=0` (the first env host) instead of
   the new connection.
2. **Data loss on first run**: `getOrCreateDeviceKey` is check-then-act with no
   lock, and `saveConnections` is fired unawaited from several updaters. Two
   concurrent first saves can both generate a device key; last write wins, and
   anything encrypted with the discarded key is permanently undecryptable —
   `loadConnections` swallows the failure, so saved connections silently vanish.

## Current state

`apps/dashboard/src/lib/hooks/use-browser-connections.ts:82-93`:

```ts
let result = newConnection            // hostId: 0 placeholder
setConnections((prev) => {
  const existingHostIds = prev.map((c) => c.hostId)
  const hostId = Math.min(...existingHostIds, 0) - 1
  result = { ...newConnection, hostId }
  const updated = [...prev, result]
  void saveConnections(updated)       // unawaited, impure updater
  return updated
})
return result
```

Caller: `apps/dashboard/src/components/connections/add-host-dialog.tsx:78-80`
(`created.hostId` → navigate). Unawaited saves also at ~lines 105, 114.

`apps/dashboard/src/lib/connection-crypto/browser-crypto.ts:26-51`
(`getOrCreateDeviceKey`): reads key from IndexedDB (`readonly` tx); if absent,
`generateKey` + `put` in a separate `readwrite` tx — the TOCTOU window.
`loadConnections` swallows decrypt errors (~use-browser-connections.ts:32-36).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/lib/hooks src/lib/connection-crypto` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: `use-browser-connections.ts` (addConnection purity),
`browser-crypto.ts` (single-flight key creation), tests.

**Out of scope**: the encryption algorithm/parameters; D1 user-connections
(server-side, separate store); the dialog component.

## Git workflow

- Branch: `advisor/87-browser-connection-store-fixes`
- Commit(s): `fix(connections): compute new hostId outside state updater`,
  `fix(connections): single-flight device-key creation`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Pure addConnection
Compute `hostId` from the hook's current `connections` value before dispatch;
build the full connection object; `setConnections(prev => ...)` purely (handle
the edge where `prev` gained a connection since render by recomputing inside
but returning the deterministic object — simplest correct shape: compute inside
the updater but ALSO return a Promise resolved via a `useRef`+effect, OR
restructure to compute from the hook state and accept the rare double-add
collision by re-deriving `Math.min` — read how `updateConnection`/`removeConnection`
in the same file handle state and match style). Move `saveConnections` out of
the updater.
**Verify**: new test — calling `addConnection` returns an object with a negative
`hostId` that equals the one persisted; `bun test src/lib/hooks` pass.

### Step 2: Single-flight device key
Module-scope `let keyPromise: Promise<CryptoKey> | null`; `getOrCreateDeviceKey`
returns the existing promise when set, else assigns it (creation + store). On
failure reset to null so a retry can succeed. Optionally re-read inside the
`readwrite` tx before `put` (get-or-put atomically) for cross-tab safety.
**Verify**: new test — two concurrent `getOrCreateDeviceKey()` calls resolve to
the SAME CryptoKey instance (mock/fake-indexeddb: check the repo's existing
crypto tests under `src/lib/connection-crypto/` for the harness).

### Step 3: Stop swallowing decrypt failures silently
In `loadConnections`' catch, keep returning `[]` but log a distinct warning
("stored connections could not be decrypted") so the failure is diagnosable.
**Verify**: test asserting the warning on a corrupted payload.

## Done criteria

- [ ] `addConnection` return value is deterministic and correct (tested)
- [ ] Concurrent key creation yields one key (tested)
- [ ] Build + tests green; `plans/README.md` updated

## STOP conditions

- No IndexedDB test harness exists and adding one (fake-indexeddb) requires a
  new dependency — report the dependency for approval instead of installing.
- StrictMode double-invocation reveals the updater is relied on elsewhere for
  idempotency — report.

## Maintenance notes

- Cross-TAB key race remains theoretically possible without the transactional
  get-or-put; if user reports of vanished connections persist, that's the next
  suspect.
