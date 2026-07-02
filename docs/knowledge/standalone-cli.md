---
id: standalone-cli
title: Standalone CLI (Rust)
type: reference
status: active
updated: 2026-05-13
tags:
  - rust
  - cli
  - tui
  - tools
related:
  - rust-wasm-performance
  - mcp-server
---

# Standalone chmonitor CLI (Rust)

`rust/ch-monitor-cli` provides a standalone CLI that talks to the existing API.

## Config Loading

Priority order:
1. `--config /path/to/config.toml`
2. `CHM_CONFIG` env var
3. Default `~/.config/chm/config.toml`
4. Direct flags/env override file values

```toml
base_url = "http://localhost:3000"
host_id = 0
api_key = "chm_xxx"
default_chart = "query-count"
```

## Commands

```bash
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- hosts
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- chart query-count --limit 50
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- table running-queries --limit 30
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- tui query-count
```

## API Key Support

- CLI sends `x-api-key` header when `api_key` is configured
- Server-side API key protection enabled when `CHM_API_KEY_SECRET` is set
- Generate key via API:

```bash
curl -X POST http://localhost:3000/api/v1/auth/api-key \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CHM_API_KEY_SECRET" \
  -d '{"label":"cli","days":30}'
```

## Dependencies

| Library | Purpose |
|---------|---------|
| `clap` | CLI parser with env support |
| `reqwest` + `tokio` | Async HTTP |
| `comfy-table` | Table rendering |
| `ratatui` + `crossterm` | TUI stack |

## CI & Release

- **CI**: `cli-rust-ci.yml` — fmt, clippy, build, test
- **Release**: Tag format `chm-v*` (e.g. `chm-v0.1.0`)
- **Release workflow**: `cli-rust-release.yml` builds Linux/macOS binaries
