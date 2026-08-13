---
id: frontend-perf-baseline
title: Frontend Performance Baseline
type: reference
status: active
updated: 2026-08-14
tags:
  - performance
  - memory
  - profiling
  - caching
  - charts
related:
  - memory-optimization
  - static-site-architecture
  - workers-cache
  - conventions
---

# Frontend Performance Baseline

Measured numbers for the dashboard's runtime cost, the method used to get them,
and — importantly — **where the cost is not**, so future work does not get spent
on the wrong thing.

All figures come from profiling the live cloud demo (`dash.chmonitor.dev`,
anonymous read-only demo host, `hostId=0`) on 2026-08-14. Re-measure before
citing these as current; they are a snapshot, not an invariant.

## Method

Profiling used Playwright/Chromium driving the deployed app. Three harnesses,
each answering a different question:

1. **Page-load + idle** — load a route, wait for network idle, then sit idle for
   75 s. Records per-endpoint request counts, payload bytes, JS heap, DOM nodes,
   listeners.
2. **First-N-seconds probe** — count API requests in the **first 12 s only**.
   This is the important one: the fastest refresh preset is `FAST_15S`
   (`lib/swr/config.ts`), so *any* repeat of an identical URL inside 12 s is a
   genuine duplicate fetch and not a scheduled refresh. Every duplicate-request
   bug below was found this way.
3. **Retention probe** — navigate a loop of routes N times with a forced
   `HeapProfiler.collectGarbage` between cycles, comparing post-GC heap.

Chrome DevTools MCP could not be used (it looks for `/opt/google/chrome/chrome`);
Playwright's bundled Chromium works, given an explicit `executablePath`.

> **When adding a "performance fix", measure with harness 2 first.** Aggregate
> request counts over a long window conflate polling with duplication and will
> send you after the wrong bug — that mistake was made and corrected during this
> pass.

## Baseline numbers

### Page load (`/overview`)

| metric | value |
|---|---|
| FCP | 856 ms |
| DOMContentLoaded | 963 ms |
| JS shipped | ~1.0 MB |
| API bytes, one session | ~1.07 MB |

### Idle polling (tab visible, no interaction)

| route | req/min |
|---|---|
| `/overview` | 115.2 |
| `/insights` | 54.4 |

Tracked in [#2992](https://github.com/chmonitor/chmonitor/issues/2992) — the
question there is whether each chart's interval matches its data's volatility,
not whether polling should exist.

### Memory — healthy, do not optimize

4 navigation cycles over 5 routes, forced GC between each:

| sample | heap MB | nodes | listeners | persisted cache KB |
|---|---|---|---|---|
| baseline | 56.4 | 5243 | 8868 | 217.9 |
| cycle-1 | 54.8 | 5010 | 9625 | 234.2 |
| cycle-2 | 56.3 | 5038 | 9639 | 234.7 |
| cycle-3 | 56.1 | 5066 | 9654 | 234.7 |
| cycle-4 | 56.9 | 5118 | 9677 | 236.2 |

**There is no memory leak.** Post-GC heap is flat, DOM nodes are stable, and
listeners plateau after the first cycle (+15–23/cycle, not compounding). The
persisted query cache sits at ~236 KB against a ~5 MB localStorage quota, so
quota exhaustion is not a near-term risk either.

Browser memory is **not** where this app's cost lives. Request fan-out and
payload size are. Treat a proposed "memory optimization" here as needing a fresh
measurement first.

## Fixed during this pass

| what | root cause | result |
|---|---|---|
| 8–16 duplicate `GET /api/v1/dashboard/settings` per load ([#2984](https://github.com/chmonitor/chmonitor/issues/2984)) | `useUserSettings` was `useState`+`useEffect`+raw `apiFetch`, outside TanStack Query, so no dedup; called once per nav entry by `MenuItem`/`SubMenuItem` | 16 → 1 |
| 3 concurrent `POST /api/v1/insights/generate`, ~30 ClickHouse scans instead of ~10 ([#2985](https://github.com/chmonitor/chmonitor/issues/2985)) | auto-generate guard was a **per-instance** `useRef`; three components mount the hook | 3 → 1 |
| `new-parts-created` shipping 87.8 KB/response ([#2986](https://github.com/chmonitor/chmonitor/issues/2986)) | four columns selected that no consumer reads | −60.4% (→ 34.8 KB) |

## Rules these produced

1. **A hook that fetches must go through TanStack Query.** A bare
   `useEffect` + `apiFetch` has no deduplication and no shared cache, so its
   request count multiplies by the number of mounted consumers. This is
   invisible in code review and only shows up under harness 2.
2. **A "once per session/host" guard must not live in a `useRef`.** Refs are
   per-instance. If several components mount the hook, put the guard at module
   scope and expose a claim function so it is testable.
3. **State shared by multiple mounts of the same hook belongs in the query
   cache, not `useState`.** Deduplicating a fetch without also sharing its
   result just moves the bug: one instance gets the data and the rest render
   empty.
4. **Only select columns a consumer reads.** `readable_*` twins are a
   `BackgroundBar` convention for *tables* (see the root `CLAUDE.md`); charts
   that plot raw values should not pay for them on the wire.
5. **Client-derived caches must be excluded from the persister.** `QueryProvider`
   dehydrates every successful query. A query that mirrors another localStorage
   store and is configured `staleTime: Infinity` + `refetchOnMount: false` would
   rehydrate, win permanently, and the real store would never be read again. Add
   such keys to `NEVER_PERSIST_QUERY_KEYS` in `lib/query/provider.tsx`.

## Known-good, do not re-propose

These already exist; proposing them as improvements is a false positive:

- visibility-paused polling (`visibilityAwareInterval`)
- `staleTime` tied to the refresh interval (`use-chart-data.ts`)
- `placeholderData: (prev) => prev` to avoid blanking on host/range change
- no retry on 4xx (except 429), exponential backoff otherwise
- shared edge cache for anonymous requests, plus `s-maxage` /
  `stale-while-revalidate` per `cachePolicy` (cold `query-count` 3.58 s → warm
  0.165 s)
- persisted query cache with a 24 h `maxAge` and a git-SHA buster
- graceful degradation for optional tables (200 + `unavailable` rather than 500)
