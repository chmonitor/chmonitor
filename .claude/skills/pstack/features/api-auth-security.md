# API, auth, and security

The API is a security boundary. Validation must distinguish public liveness,
ClickHouse-gated readiness, authenticated data access, write authorization,
and machine-to-machine webhook authentication.

## Sub-features

- `api-health` separates `/healthz`, `/api/health`, and `/api/healthz`.
- `api-host-id` rejects negative and fractional host indices at the route
  boundary with `400`.
- `api-sql-safety` validates allowlisted or stored queries and enforces
  ClickHouse `readonly=1` on browser and data query paths.
- `api-auth` covers public CLI discovery, API-key issuance, device login,
  Clerk, trusted/proxy providers, and cloud guest exceptions.
- `api-isolation` covers cloud demo-host hiding, per-user connection
  ownership, rate limits, and cache identity boundaries.
- `api-egress-safety` covers webhook SSRF validation, HTTPS requirements,
  signature checks, redirect handling, and secret redaction.
- `api-signature` covers Clerk, GitHub deployment, Polar, event-ingest, and
  outbound subscription HMAC contracts.

## How to get to it (user POV)

- Open `GET /api/health` for the public deployment response.
- Check `GET /healthz` for process liveness and `GET /api/healthz` for
  ClickHouse readiness only when the deployment and source are expected to be
  available.
- Read `GET /api/v1/auth/cli` to discover the CLI auth method without a
  secret.
- Use a signed-in or approved machine client for `/api/v1/hosts`,
  `/api/v1/menu-counts`, `/api/v1/charts/{name}`, and `/api/v1/tables/{name}`.
- Use the SQL console or Explorer paths for `/api/v1/data` and
  `/api/v1/browser-connections/proxy`; arbitrary SQL is not a valid proof of a
  successful request.
- Use the documented webhook receivers for external events. Their signature,
  not an assumed browser session, is the authentication mechanism.

## Driving it with CI

Preconditions:

- Do not mint or request a real API key in a local validation note.
- CI-injected secrets stay inside the workflow that owns them.

- **Unit and structural contracts.** In `.github/workflows/test.yml`, job
  `unit-tests`, inspect the auth, rate-limit, host-id, SQL validation,
  readonly, security-header, cloud-demo-host, signature, and webhook tests
  under `apps/dashboard/src`. Important source tests include
  `routes/api/__tests__/hostid-validation-contract.test.ts`,
  `routes/api/v1/data/__tests__/sql-validation.test.ts`,
  `routes/api/v1/data/__tests__/readonly.test.ts`, and
  `routes/api/v1/health/webhook.test.ts`.
- **Public API smoke.** The `e2e-test` job runs
  `apps/dashboard/cypress/e2e/api-endpoints.cy.ts`. It checks the health
  statuses and accepts the valid open-auth or gated-auth response for `/api/v1`
  routes. Record which posture the job used; it does not prove an authenticated
  query by itself.
- **Deployment auth proof.** In `.github/workflows/cloudflare.yml`, job
  `dashboard`, step `Verify deployment`, `apps/dashboard/scripts/verify-deploy.ts`
  mints a short-lived key only when CI provides `CHM_API_KEY_SECRET`. It then
  checks authenticated health metadata and a registry-backed `menu-counts`
  query. Never reproduce the secret or the full token in evidence.
- **Cloud and deployment-mode contracts.** `unit-tests` covers
  `cloud-saas-mode` behavior, deployment defaults, agent guest allowances, and
  cloud demo-host rejection. The relevant source truth is
  `apps/dashboard/src/lib/feature-permissions/server.ts` and
  `apps/dashboard/src/lib/auth/agent-api-auth.ts`.
- **External webhook delivery.** No normal CI job sends a real customer
  webhook. Use the mocked fetch and render tests as unit evidence. A live send
  is `verified-unreachable` unless an approved environment and target are named
  separately from the code proof.
- **Evidence.** Record route, method, status class, auth posture, and the
  workflow/job. For a failure, quote the response shape and assertion, not a
  secret-bearing request dump.

## Gotchas

- `/api/healthz` is ClickHouse-gated. Its `503` is not interchangeable with a
  failed process or a failed anonymous auth gate.
- `CHM_AUTH_PROVIDER=none` intentionally makes the single-tenant backend open.
  A `200` from a protected route in that mode is not evidence that Clerk or
  API-key enforcement works.
- Cloud anonymous guest agent access is a narrow allowlist. Do not generalize
  it to conversations, user connections, actions, or arbitrary writes.
- API keys are JWT-shaped values with a signature segment. A truncated token
  is a harness error, not a server authorization result.
- `hostId=-1` and `hostId=1.5` are invalid route inputs. The stricter
  non-negative-integer boundary must return `400` before data access.
- SSRF checks apply to caller-supplied ClickHouse, browser-connection,
  PeerDB-validation, and webhook URLs. Do not “prove” a target by using a
  private or metadata address.
- Signature-bearing webhook routes are unauthenticated by design only because
  the signature is verified over the raw body. A missing or invalid signature
  must not be treated as an ordinary session failure.
- Never save `Authorization` headers, API keys, cookies, passwords, or private
  webhook URLs in evidence.
