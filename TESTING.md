# Testing Guide

This document explains the comprehensive testing strategy for the ClickHouse monitoring dashboard, including unit tests, integration tests, component tests, and best practices.

## Test Categories

### 1. Unit Tests

Fast, isolated tests that don't require external dependencies.

**Examples:**

- `lib/clickhouse.test.ts` - Tests configuration parsing and client setup
- `lib/utils.test.ts` - Tests utility functions
- `lib/format-readable.test.ts` - Tests data formatting

**Pattern:**

```typescript
// Mock external dependencies
jest.mock('@clickhouse/client', () => ({
  createClient: jest.fn(),
}))

// Test the logic, not the external service
it('should parse host configuration correctly', () => {
  process.env.CLICKHOUSE_HOST = 'host1,host2'
  const result = getClickHouseHosts()
  expect(result).toEqual(['host1', 'host2'])
})
```

### 2. Integration Tests with Mocks

Tests that simulate integration between components without real external services.

**Examples:**

- `lib/query-config/__tests__/query-config.test.ts` - Tests query configurations with mocked database
- `lib/__tests__/host-switching-integration.test.ts` - Tests host switching logic

**Pattern:**

```typescript
// Mock the external service
jest.mock('@/lib/clickhouse', () => ({
  fetchData: jest.fn(),
}))

// Test the integration logic
it('should handle host switching correctly', async () => {
  const mockFetchData = fetchData as jest.MockedFunction<typeof fetchData>
  mockFetchData.mockResolvedValue({ data: [...], metadata: {...} })

  // Test your component logic here
})
```

### 3. Static Analysis Tests

Tests that analyze code without executing it.

**Examples:**

- `lib/__tests__/fetchdata-hostid.test.ts` - Ensures all fetchData calls include hostId

### 4. Optional Integration Tests

Tests that run only when real ClickHouse is available.

**Examples:**

- `lib/__tests__/integration-environment.test.ts` - Real database tests when available

### 5. Component Tests

Visual and behavioral tests for UI components using Cypress.

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
of the existing `bun run test` / `bun run test:coverage` CI job since those
already glob all of `src/`.

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

For more detailed examples, refer to the existing component tests in the `components` directory.

## Tools and Libraries

We use Cypress for our component testing. Refer to the Cypress documentation for more details on writing tests using Cypress.

## Continuous Integration

All component tests are automatically run as part of the Continuous Integration (CI) pipeline on every pull request. Ensure your tests pass locally before submitting your pull request.

## Running Tests

### All Tests (Recommended)

```bash
bun run test
```

This runs unit tests with mocked dependencies - fast and reliable.

### Query Configuration Tests

```bash
bun run test-queries-config
```

Tests query configurations with mocked database responses.

### Component Tests

```bash
bun run test:component:headless  # Run component tests
bun run test:e2e:headless        # Run end-to-end tests
```

### With Coverage

```bash
bun run jest              # Excludes query-config tests
bun run test-queries-config  # Only query-config tests
```

## Test Environment Setup

### Automated Setup

Tests use `jest.setup.js` for:

- Mock implementations of `fetchData` and `getHostIdCookie`
- Test utilities for host switching scenarios
- Consistent mock data across tests

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
bun run test
```

## Writing New Tests

### For New Components

1. **Mock external dependencies** (ClickHouse, APIs)
2. **Test business logic**, not external services
3. **Use the existing mock utilities** from `jest.setup.js`

### For New Query Configurations

1. Add to `queries` array in your config file
2. Mark as `optional: true` if the query depends on optional ClickHouse features
3. The test will automatically validate SQL syntax and parameter handling

### For Host Switching Features

1. Use `mockGetHostIdCookie` and `mockFetchData` from test utilities
2. Test both host switching scenarios and error cases
3. Verify `hostId` parameter is included in all `fetchData` calls

## Best Practices

### ✅ Do

- Mock external dependencies (databases, APIs, file system)
- Test business logic and component behavior
- Use descriptive test names that explain the scenario
- Test both success and error cases
- Include timeout configuration for async tests

### ❌ Don't

- Make real database connections in unit tests
- Rely on external services being available
- Test implementation details instead of behavior
- Skip error handling scenarios
- Leave tests without timeout configuration

## Troubleshooting

### Test Timeouts

If tests are timing out:

1. Check if you're making real HTTP/database calls instead of using mocks
2. Verify `jest.config.js` has appropriate timeout settings
3. Ensure async tests are properly awaited

### Mock Issues

If mocks aren't working:

1. Verify mock setup in `jest.setup.js`
2. Check that mocks are imported before the modules they mock
3. Use `jest.clearAllMocks()` in `beforeEach` hooks

### Integration Test Skipping

Integration tests automatically skip when:

- `CI=true` environment variable is set
- `CLICKHOUSE_HOST` is not configured
- ClickHouse connection fails within 5 seconds

This is expected behavior - unit tests with mocks provide sufficient coverage.

## Recent Timeout Fixes

The project recently fixed Jest timeout issues caused by:

1. **Real Database Connections**: `query-config.test.ts` was trying to connect to real ClickHouse
2. **Missing Timeout Configuration**: Jest had no timeout limits configured
3. **Missing Mock Setup**: Integration tests lacked proper mock infrastructure

### Fixed By:

1. **Added Jest timeout configuration** (30 seconds)
2. **Created comprehensive mock setup** in `jest.setup.js`
3. **Converted integration tests** to use mocks instead of real connections
4. **Added optional integration tests** that only run when ClickHouse is available
5. **Enhanced error handling** with proper mock responses
