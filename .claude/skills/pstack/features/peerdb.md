# PeerDB agent, metrics, and alerts

PeerDB monitoring is a read-only integration. The user can inspect connection
status and fleet health, ask the agent for mirror triage, and receive PeerDB
insights or alerts. Mutating PeerDB operations are outside the surface.

## Sub-features

- `peerdb-status` reports configured, connected, auth-failed, unreachable, or
  not-configured state without exposing credentials.
- `peerdb-metrics` summarizes mirrors, peers, slots, rows synced, lag, and
  partial failures for the dashboard.
- `peerdb-proxy` allows only the fixed read-only PeerDB path and method set.
- `peerdb-auth` supports open, empty-user Basic, and Bearer configurations
  without putting a secret in the URL or browser payload.
- `peerdb-connection` selects an owned per-user connection and fails closed
  when the selector is unknown or unowned.
- `peerdb-cache` caches only env-wide metrics. Per-connection responses are
  re-fetched and never served from the shared cache.
- `peerdb-agent` exposes `get_peerdb_mirror_status` only when
  `CHM_FEATURE_PEERDB_AGENT=true` and the PeerDB feature is not disabled.
- `peerdb-insights-alerts` classifies failed, paused, lagging, noisy, and
  stalled mirrors and feeds the health-sweep path.

## How to get to it (user POV)

- Open `/peerdb` for mirrors and `/peerdb/peers` for peer and slot state when
  the `peerdb` feature is available.
- Add `?connection=<id>` only when a signed-in user owns that connection. The
  browser must never be given the PeerDB secret.
- In the agent chat, ask which mirrors are lagging or failing. The PeerDB tool
  is a read-only diagnostic, not a control operation.
- Read PeerDB insights from the Insights surface and observe health-sweep
  behavior only in an approved configured environment.

## Driving it with CI

Preconditions:

- Normal CI does not provide a real PeerDB service, URL, or credential.
- The `scripts/peerdb-mock-server.ts` file is a documented test double with
  static data; it does not validate authentication and is not a live proof.

- **Status, auth, and cache isolation.** In `.github/workflows/test.yml`, job
  `unit-tests`, inspect `apps/dashboard/src/lib/peerdb/peerdb-auth.test.ts`,
  `peerdb-config.test.ts`, the API route tests, and
  `routes/api/v1/__tests__/peerdb-metrics.cache-isolation.test.ts`. The
  observable contract is configured/not-configured output, auth header parity,
  fail-closed ownership, and no cross-user cache hit.
- **Proxy and agent safety.** Inspect the unit coverage for
  `routes/api/v1/peerdb/$.ts`, `routes/api/v1/peerdb/validate.ts`,
  `lib/ai/agent/tools/__tests__/peerdb-tools.test.ts`, and
  `peerdb-tools-gate.test.ts`. Assert the allowlist, name validation, bounded
  output, config stripping, and flag gate.
- **Metrics and insights.** Inspect `lib/insights/peerdb-checks.test.ts` and
  `peerdb-collectors.test.ts` in the same unit job. They cover thresholds,
  hostile-reader degradation, Basic/Bearer parity, and unconfigured silence.
- **Agent behavior.** `.github/workflows/agent-eval.yml` runs only for its
  prompt, skill, and eval path filter and is informational. It is not a
  substitute for the PeerDB tool unit tests and may be skipped when live
  credentials are absent.
- **Live configured path.** Only claim a connected PeerDB result when a named
  CI/deployment environment supplied `PEERDB_API_URL` and the corresponding
  auth configuration. Otherwise report the unconfigured or unreachable state
  as the expected observation, not as a successful live integration.
- **Evidence.** Record whether the proof was mocked, mock-server-backed, or
  live, plus the exact endpoint/tool and the resulting fleet summary. Do not
  record the URL secret or a raw authorization header.

## Gotchas

- `GET /api/v1/peerdb-status` can return HTTP `200` with a structured
  `auth` or `unreachable` state. HTTP success alone is not a connected result.
- `GET /api/v1/peerdb-metrics` can be `partial` when an individual mirror or
  peer fails. Preserve that distinction in the evidence.
- An explicit `?connection=` selector must never silently fall back to the
  env-wide source when ownership fails.
- The agent tool is absent unless the exact feature flag is `true`; values
  such as `1` do not enable it.
- PeerDB connector configuration can contain secrets. The agent result must
  not contain the raw `cdcStatus` or `qrepStatus` config blocks.
- The read-only proxy accepts selected POST endpoints because those endpoints
  are status or history reads. It does not make arbitrary PeerDB mutations
  reachable.
- The mock server is useful for UI shape exploration, but it proves neither
  authentication nor upstream behavior.
