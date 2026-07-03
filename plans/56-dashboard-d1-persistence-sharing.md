# 56 — Dashboard D1 persistence & sharing

## Goal
Dashboards persist to D1 per owner with an optional share link/ACL; localStorage remains a fallback when D1 is unavailable (self-host/offline). Reads/writes are owner-scoped (no IDOR).

## Current reality (audited)
Dashboards persist in localStorage only (`apps/dashboard/src/lib/dashboard-storage.ts`); the chart list is JSON-serializable. A D1 store pattern exists for conversations (`apps/dashboard/src/lib/conversation-store/d1-store.ts`, incl. an IDOR-guarded upsert) but is not wired to dashboards — no cross-device sync, no sharing, no team defaults.

## Implement now (depth F)
- Add a D1 migration `apps/dashboard/src/db/conversations-migrations/NNNN_dashboards.sql`: `dashboards(id TEXT PK, owner_id TEXT, name TEXT, layout_json TEXT, is_shared INT, share_slug TEXT, updated_at INT)` + index on `owner_id`.
- New store `apps/dashboard/src/lib/dashboard-storage/d1-store.ts` mirroring the conversation D1 store (lazy `CREATE TABLE IF NOT EXISTS`, owner-scoped reads/writes, IDOR guard on upsert).
- Extend `dashboard-storage.ts` to prefer D1 when the binding is present, else localStorage.
- Routes `apps/dashboard/src/routes/api/dashboards/{list,save,delete,share}.ts` — owner-resolved, fail-open for self-host; `share` mints a `share_slug` and a read-only public GET (gated per plan via `plan-enforcement`/`entitlements` — mark `deferred` if sharing is a GA gate).
- Tests: owner A cannot read owner B's dashboard (IDOR); D1-absent falls back to localStorage; share link resolves read-only.

## STOP conditions & drift check
- STOP if the conversation D1 store contract changed — reuse its patterns, don't fork them.
- STOP before enforcing a sharing paywall while in free beta — classify it in `plan-enforcement` (`enforced` vs `deferred`) explicitly.
- Drift: confirm `dashboard-storage.ts` shape and the migrations directory numbering.

## Done criteria
- Dashboards persist to D1 per owner and sync across devices; localStorage fallback works.
- Share link is read-only and owner-scoped; IDOR test passes.
- Sharing gate classified in `plan-enforcement` (enforced or deferred).
