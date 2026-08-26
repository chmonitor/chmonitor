# Rust workspace

Crates under `rust/` support the chmonitor dashboard (WASM), benchmarks, and the
standalone `chm` CLI. The CLI is intentionally **not** wired to sibling crates —
it uses external dependencies only (`rust/ch-monitor-cli/Cargo.toml`).

## Consumer map

| Crate | Primary consumer(s) | Status |
| --- | --- | --- |
| `ch-json` | `monitor-core` (library), published to crates.io | Product library |
| `ch-pivot` | `monitor-core` (user-event pivot exports) | Product library |
| `monitor-core` | WASM bundle via `scripts/build-wasm.ts` (shipped in the workspace client package) | WASM-only (shipped) |
| `ch-monitor-cli` | End users (`chm` / `chmonitor` binaries) | Product (standalone) |
| `user-events-rs` | `scripts/benchmarks/user-events-transform-benchmark.mjs` only | Benchmark-only |

## Notes

- **CLI isolation:** `ch-monitor-cli` does not depend on `ch-json`, `ch-pivot`,
  or `monitor-core`. Keep it that way unless there is a clear product need.
- **Object pivots stay in TypeScript:** User-event chart transforms run in
  `apps/dashboard/src/lib/chart-data-transforms/transforms/user-events.ts`
  (`transformUserEventCounts`). Rust/WASM pivot code exists for benchmarks only
  — see `docs/knowledge/rust-wasm-performance.md`.
- **`user-events-rs`:** Retained for the user-events transform benchmark. If it
  stays benchmark-only long-term, consider archiving it (maintainer decision).
- **`monitor-core`:** No native CLI binary — JSONEachRow normalization lives in
  `ch-json`; the WASM build is the production consumer.

## Commands

```bash
cd rust && cargo build --workspace
cd rust && cargo test --workspace
cd rust && cargo clippy --workspace -- -D warnings
```
