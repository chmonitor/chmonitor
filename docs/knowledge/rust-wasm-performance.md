---
id: rust-wasm-performance
title: Rust and WASM Performance
type: decision
status: active
updated: 2026-05-09
source_pr: 1021
tags:
  - rust
  - wasm
  - benchmark
  - performance
related:
  - memory-optimization
  - standalone-cli
---

# Rust and WASM Performance

## Decision

Keep object-heavy transforms in TypeScript. Use Rust/WASM only for JSON-preserving or byte/string-heavy paths where data can stay serialized across the JS/WASM boundary.

Do not promote native Rust subprocess transforms into hot API paths. Process startup and IPC overhead dominate the benchmark for small and medium inputs.

## Why

Benchmark evidence from PR #1021 showed:
- JSONEachRow normalization reached roughly parity to 1.2x faster
- User-event object pivots were much slower in WASM v1/v2/v3
- Rust CLI subprocess transforms not viable for hot browser/API paths

## How to Apply

- Re-run `bun run scripts/bench-wasm.ts` after changing `rust/monitor-core`, `packages/clickhouse-client/src/wasm/monitor-core.ts`, or `scripts/bench-wasm.ts`
- Keep the promotion threshold at 1.20x
- Preserve lazy loading for the WASM bundle — do not add it to default dashboard or client bundles
- For `rust/ch-monitor-cli`, keep TUI refresh cadence bounded (one chart fetch every 5s)

## Latest Benchmark (May 1, 2026)

| Candidate | Size | TS ms | Candidate ms | Speedup | Promote |
|---|---:|---:|---:|---:|---|
| clickhouse-jsoneachrow-to-objects | large | 183.30 | 205.58 | 0.89x | no |
| clickhouse-jsoneachrow-to-json | large | 188.25 | 158.73 | 1.19x | no |
| chart-api-response-envelope | large | 190.31 | 164.56 | 1.16x | no |
| clickhouse-jsoneachrow-native-cli | large | 176.85 | 148.65 | 1.19x | no |

## Artifacts

- `scripts/bench-wasm.ts` — benchmark runner
- `scripts/build-wasm.ts` — WASM build script
- `rust/monitor-core` — Rust source
- `packages/clickhouse-client/src/wasm/monitor-core.ts` — JS bindings
- `packages/clickhouse-client/src/wasm/generated/monitor_core_bg.wasm` — compiled WASM
