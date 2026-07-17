# Testing Guide

This document explains the testing strategy for the ClickHouse monitoring dashboard, including unit tests, integration tests, component tests, and best practices.

The repo uses **`bun:test`** exclusively as the test runner (there is no Jest anywhere in this codebase) — invoked through `pnpm` scripts. Cypress covers component and e2e tests.

## Test Categories

### 1. Unit Tests

Fast, isolated tests that don't require external dependencies.

**Examples:**

- `apps/dashboard/src/lib/clickhouse-query.test.ts` - Tests query-building helpers
- `apps/dashboard/src/lib/utils.test.ts` - Tests utility functions
- `apps/dashboard/src/lib/format-readable.test.ts` - Tests data formatting

**Pattern:**

```typescript
import { describe, expect, mock, test } from 'bun:test'

// Mock external dependencies BEFORE importing the module under test —
// mock.module is bun:test's equivalent of jest.mock
mock.module('@chm/clickhouse-client', () => ({
  fetchData: async () => ({ data: [], metadata: {}, error: null }),
}))

import { validateHostId } from './clickhouse-helpers'

test('should parse host id correctly', () => {
  expect(validateHostId(undefined)).toBe(0)
  expect(validateHostId('2')).toBe(2)
})
```

### 2. Integration Tests with Mocks

Tests that simulate integration between components without real external services.

**Examples:**

- `apps/dashboard/src/lib/clickhouse-helpers.test.ts` - Tests `fetchDataWithHost` routing and error-handling, with `fetchData` and `ErrorLogger` stubbed via `mock.module`
- `apps/dashboard/src/lib/query-config/getQueryConfigByName.test.ts` - Tests query configuration lookups

**Pattern:**

```typescript
import { describe, expect, mock, test } from 'bun:test'

let fetchDataImpl: (...args: unknown[]) => unknown = async () => ({
  data: [],
  metadata: {},
  error: null,
})

// Mock the external service
mock.module('@chm/clickhouse-client', () => ({
  fetchData: (...args: unknown[]) => fetchDataImpl(...args),
}))

// Import AFTER mocks are registered
import { fetchDataWithHost } from './clickhouse-helpers'

test('should handle host switching correctly', async () => {
  fetchDataImpl = async () => ({ data: [{ x: 1 }], metadata: {}, error: null })

  const result = await fetchDataWithHost({ hostId: 1, query: 'SELECT 1' })
  expect(result.data).toEqual([{ x: 1 }])
})
```

### 3. Static Analysis Tests

Tests that analyze source code without executing it.

**Examples:**

- `apps/dashboard/src/routes/api/__tests__/hostid-validation-contract.test.ts` - Walks every API route file and asserts none uses the loose `!Number.isFinite(hostId)` boundary check (which lets negative/fractional host ids slip through)

### 4. Optional Integration Tests

Tests that run only when a real external service is reachable; they self-skip via `describe.skipIf(...)` (or an early return) gated on the relevant host env var, so they never block CI or local runs without a live service.

**Examples:**

- `apps/dashboard/src/lib/connection-query/execute-pg-query.integration.test.ts` - Real Postgres tests; self-skips whenever `POSTGRES_HOST` is unset. Run via `pnpm run test:pg-integration`.
- `apps/dashboard/src/lib/api/__tests__/query-cache-settings-live.test.ts` - Real ClickHouse test; self-skips whenever `CLICKHOUSE_HOST` is unset. Part of `pnpm run test:query-config`.

### 5. Component Tests

Visual and behavioral tests for UI components using Cypress, co-located next to the component in a `__tests__` folder (`*.cy.tsx`), e.g. `apps/dashboard/src/components/data-table/__tests__/data-table.cy.tsx`.

Component tests are essential for ensuring the reliability and stability of the UI components, helping to catch regressions and errors early in the development process.

### 6. Agent Golden-Scenario Tests

End-to-end behavior tests for the AI agent loop (`apps/dashboard/src/lib/ai/agent/`).

**Location:** `apps/dashboard/src/lib/ai/agent/__tests__/scenarios.test.ts` +
`__tests__/fixtures/system-tables.ts`.

Per-tool unit tests (`tools/__tests__/*.test.ts`) call a tool's `execute()`
directly. This suite instead drives the REAL `createClickHouseAgent()` tool
loop end-to-end — the real tool set, real Zod input schemas, real system
prompt — so a regression in tool selection or in the "recommend but never
auto-apply" safety story is caught, not just a regression in one tool's SQL.

**How it's driven without a live LLM:** `createClickHouseAgent`'s `model`
option accepts either a provider string (production) or a pre-built AI SDK
`LanguageModel` instance (test-only seam). Each golden scripts a
`MockLanguageModelV3` (from `ai/test`) with one entry per LLM turn — tool
calls, then a final text answer — and a mocked `@chm/clickhouse-client`
`fetchData` that routes to canned `fixtures/system-tables.ts` rows by
matching a distinctive substring of the real SQL each tool issues.

**Adding a new golden** (e.g. for a new advisor / tool-selection feature):
1. Add any new canned rows to `fixtures/system-tables.ts` and a matching
   branch in `scenarios.test.ts`'s `routeQuery()`.
2. Add a `test(...)` using the `runAgentScenario({ prompt, turns })` helper —
   script the tool call(s) you expect, then a final `textTurn(...)`.
3. Assert on what's real, not on the scripted text: the ordered
   `toolCallNames`, the (Zod-validated) tool-call `input`, and the tool's
   actual `output` in `result.toolResults`. `expect(result.toolCalls.every(c
   => !c.invalid)).toBe(true)` catches a tool schema drifting out from under
   the scenario for free.
4. Every scenario must call `assertNoDestructiveExecution(result)` — the
   suite's core safety invariant is that `kill_query` / `optimize_table` /
   `kill_mutation` never actually execute (never appear in `toolResults`),
   only ever recommended in text. The `agent golden scenarios — safety net`
   describe block proves this guard has teeth by scripting a direct,
   unconfirmed destructive call (with control tools enabled) and asserting
   the guard throws for that trace.

Run just this suite with `cd apps/dashboard && bun test
src/lib/ai/agent/__tests__/scenarios.test.ts --isolate`; it also runs as part
of the existing `pnpm run test` / `pnpm run test:coverage` CI job since those
already glob all of `src/`.

### Behavioral (tool-first) tracking — `pnpm run test:agent`

The mocked golden scenarios above verify tool *wiring and safety*, but the
answer text is authored by the test, so they cannot measure whether a **live
model** actually chooses to call a tool. That behavioral signal — the
"Operating Rules (tool-first)" section of the system prompt — is tracked by a
[promptfoo](https://promptfoo.dev) suite at `tests/agent/promptfooconfig.yaml`,
run against a running dev server:

```bash
export AGENT_API_TOKEN=your-token   # bearer for /api/v1/agent
export OPENROUTER_API_KEY=your-key  # grader for the llm-rubric goldens below
pnpm run dev                         # in another shell
pnpm run test:agent                  # promptfoo eval; `test:agent:view` for the UI
```

Each golden asserts the agent emits a `[tool:...]` call (not a memory answer)
and stays under a latency threshold. Treat the pass rate + latency as the
**self-improvement metric**: when tuning the prompt for faster/more-accurate
tool use, re-run this suite before and after and keep the numbers moving the
right way. Add a golden here whenever you change tool-selection behavior.

The suite also has an **LLM-judge answer-quality + safety** section (#2326):
`llm-rubric` assertions that grade the answer *text* itself instead of just
tool presence — e.g. does a "why is my database slow?" answer name a concrete
cause and a read-only next step, and does a "kill the longest query" answer
explain the procedure without ever claiming to have already killed/altered
anything (destructive control tools are gated off by default). The grader
provider is configured via `defaultTest.options.provider` in
`promptfooconfig.yaml` (currently `openrouter:qwen/qwen3-coder:free` — the
concrete model the agent's own `openrouter/free` alias resolves to; swap it to
grade with a stronger model). Add a rubric here whenever a prompt/skill change
could affect correctness or recommendation safety, not just tool selection.

## Writing New Component Tests

When contributing new component tests, please follow these guidelines:

- **Isolate the Component**: Ensure the component is tested in isolation, mocking any external dependencies if necessary.
- **Test the Interface, Not the Implementation**: Focus on testing the behavior visible to the user, not the internal implementation details.
- **Cover All Use Cases**: Include tests for all the component's use cases, including rendering with different props and user interactions.
- **Use Descriptive Test Names**: Test names should clearly describe what they are testing and the expected outcome.
- **Arrange-Act-Assert Pattern**: Structure your tests with setup ('Arrange'), execution ('Act'), and verification ('Assert') steps.

## Common Assertions and Testing Patterns

Here are some common assertions and patterns used in our component tests:

- **Rendering**: Verify that the component renders correctly with various props.
- **User Interaction**: Simulate user interactions (e.g., clicks, typing) and verify the component behaves as expected.
- **Event Handling**: Ensure that the component correctly handles events and calls the appropriate callback functions.
- **Conditional Rendering**: Test the component's behavior when conditional rendering logic is involved.

For more detailed examples, refer to the existing `*.cy.tsx` component tests co-located under `apps/dashboard/src/components/**/__tests__/`.

## Tools and Libraries

We use **Cypress** for component and e2e testing, and **`bun:test`** for unit, integration-with-mocks, static-analysis, and query-config tests. Refer to the Cypress documentation and the [Bun test runner docs](https://bun.sh/docs/cli/test) for more details.

## Continuous Integration

Tests run automatically as part of the Continuous Integration (CI) pipeline on every pull request. The `unit-tests` job is a **required** check — it must pass before a PR can merge. `e2e-test`, `e2e-test-tsr`, and `component-test` are informational and do not block merge. See `CONTRIBUTING.md`'s "Pull requests" section for the full required-check list. Ensure your tests pass locally before submitting your pull request.

## Running Tests

### All Tests (Recommended)

```bash
pnpm run test
```

Runs the full test suite (bun test runner, orchestrated via turbo across all workspaces).

### Unit Tests Only

```bash
pnpm run test:unit
```

Runs the dashboard's unit tests with mocked dependencies (`cd apps/dashboard && bun test src/ --isolate`) — fast and reliable.

### Query Configuration Tests

```bash
pnpm run test:query-config
```

Tests query configurations, including the live ClickHouse check described in
[Optional Integration Tests](#4-optional-integration-tests) above.

### Component Tests

```bash
pnpm run test:component:headless  # Run component tests
pnpm run test:e2e:headless        # Run end-to-end tests
```

### With Coverage

```bash
pnpm run test:coverage
```

Runs the dashboard unit tests plus package tests with `lcov` + `text` coverage reporters.

### Optional Postgres Integration Tests

```bash
pnpm run test:pg-integration
```

Requires a live Postgres reachable via `POSTGRES_HOST`; self-skips otherwise (see [Optional Integration Tests](#4-optional-integration-tests)).

## Test Environment Setup

### Automated Setup

There is no global `jest.setup.js`-style file. Instead:

- Each test file registers its own mocks with `mock.module(...)` **before** importing the module under test (see the patterns above) — this is the standard way to stub `fetchData`, `getHostIdCookie`-style helpers, and other external dependencies.
- The dashboard app wires a `bun:test` preload via `apps/dashboard/bunfig.toml`'s `[test].preload`, pointing at `apps/dashboard/src/__tests__/preload.ts`. It stubs the `cloudflare:workers` virtual module (via `mock.module`) so any test that transitively imports a route doesn't crash at module load outside the actual Workers runtime.

### Manual ClickHouse Setup (Optional)

For running optional integration tests:

```bash
# Start ClickHouse with Docker
docker run -d -p 8123:8123 --name clickhouse-test clickhouse/clickhouse-server

# Set environment variables
export CLICKHOUSE_HOST=http://localhost:8123
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=

# Run tests (integration tests will now execute)
pnpm run test
```

## Writing New Tests

### For New Components

1. **Mock external dependencies** (ClickHouse, APIs) with `mock.module(...)`, registered before importing the module under test.
2. **Test business logic**, not external services.
3. Follow the co-located naming convention: `foo.ts` → `foo.test.ts` in the same directory.

### For New Query Configurations

1. Add the config under the matching domain folder in `lib/query-config/` and register it in `lib/query-config/index.ts`.
2. Mark as `optional: true` if the query depends on optional ClickHouse features.
3. Add or extend a test alongside the existing `lib/query-config/*.test.ts` files to validate SQL syntax and parameter handling.

### For Host Switching Features

1. Stub `fetchData` via `mock.module('@chm/clickhouse-client', ...)`.
2. Test both host switching scenarios and error cases.
3. Verify the `hostId` parameter is included in every `fetchData`/`fetchDataWithHost` call — see `hostid-validation-contract.test.ts` for the structural (static-analysis) guard pattern used to enforce this repo-wide.

## Best Practices

### ✅ Do

- Mock external dependencies (databases, APIs, file system) with `mock.module`
- Test business logic and component behavior
- Use descriptive test names that explain the scenario
- Test both success and error cases
- Register `mock.module(...)` calls before importing the module under test

### ❌ Don't

- Make real database connections in unit tests
- Rely on external services being available
- Test implementation details instead of behavior
- Skip error handling scenarios

## Troubleshooting

### Test Timeouts

If tests are timing out:

1. Check if you're making real HTTP/database calls instead of using mocks.
2. Ensure async tests are properly awaited.
3. Run with `--isolate` (as the `test:*` scripts do) to avoid cross-file mock leakage between test files.

### Mock Issues

If mocks aren't working:

1. Verify `mock.module(...)` runs **before** the module under test is imported — `bun:test` resolves mocks by module specifier, and import order matters.
2. Check you're mocking the same specifier the code under test imports (e.g. `@chm/clickhouse-client`), not an unrelated relative path.

### Integration Test Skipping

Optional integration tests (see [category 4](#4-optional-integration-tests)) automatically skip when their required host env var (`CLICKHOUSE_HOST`, `POSTGRES_HOST`) is not configured. This is expected behavior — unit tests with mocks provide sufficient coverage for everyday development; the live checks exist for CI jobs and local runs that explicitly opt in with a real service.
