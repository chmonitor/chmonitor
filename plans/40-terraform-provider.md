# 40 — Terraform provider

## Kickoff prompt

```text
Execute plans/40-terraform-provider.md ALONE (do not read other plans).
Goal: ship a Terraform provider (NEW top-level package terraform-provider-chmonitor/)
that manages chmonitor Cloud resources via the chmonitor HTTP API + a chm_ API key:
chmonitor_{subscription,user,host,alert_rule} with clean plan/apply/destroy and a
registry publish.

This plan BOOTSTRAPS A NEW GO PACKAGE with its OWN build/test
(terraform-plugin-framework, `go build`, `go test`, `terraform-plugin-docs`). It must
NOT be added to the monorepo `bun run build` graph or break it.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE / fail-open: the provider targets a chmonitor instance
  over its API using a chm_ API key. It must work against a self-hosted base URL and
  must not require chmonitor Cloud. Resources that only exist in Cloud (subscriptions)
  simply error clearly against an OSS instance.
- SSRF: the provider makes outbound calls to the operator-configured chmonitor base
  URL only; validate it's an absolute http(s) URL. No chmonitor-side change introduces
  a new unguarded outbound fetch.
- Honest claims: only implement resources backed by real chmonitor CRUD APIs.
- Postgres/multi-DB: NO.

External setup: Go toolchain, terraform-plugin-framework, a Terraform Registry
account + GPG signing for publish. Document it.

When done, run the Verification block and paste the output.
```

## Current reality (audited)

Why (roadmap §4/40, P2/XL/E): enterprise teams want **GitOps** for their chmonitor Cloud
resources (subscriptions, hosts, alert rules, MCP servers) — a sticky, high-touch,
revenue-positive integration. There is no provider today. Per strategy §1, this meets
enterprise teams **in their IaC stack** (Terraform) rather than forcing click-ops.

Pointers (verify at head):
- `terraform-provider-chmonitor/` does **NOT** exist — this plan creates it as a NEW
  top-level Go package outside the Workers app.
- Backing APIs already exist as D1-backed routes: connections/hosts
  (`routes/api/v1/user-connections.ts`), alert config/rules, subscription/plan resolution,
  and MCP server registration (roadmap 43). The provider is a thin CRUD client over these
  `(verify each endpoint + method)`.
- API-key auth (`chm_…`) path for programmatic access `(verify the key middleware)` — reuse
  it; do not invent a new auth scheme.

## Goal

A Terraform provider that CRUDs `chmonitor_subscription`, `chmonitor_user`, `chmonitor_host`,
and `chmonitor_alert_rule` (and, if the endpoint is ready, `chmonitor_mcp_server`) against a
chmonitor instance via a `chm_` API key, produces stable plans (no spurious refresh diffs),
cleans up on `destroy`, ships docs + examples, and is published to the Terraform Registry.

## Implement now (depth E — approach + key files + open questions + external setup)

### Approach
1. **Scaffold** with HashiCorp's `terraform-plugin-framework` (Go). Provider config: `base_url`
   (default chmonitor Cloud, overridable for self-host) + `api_key` (`chm_…`, from env
   `CHMONITOR_API_KEY` or config). Validate `base_url` is absolute http(s).
2. **HTTP client** — a small typed client wrapping the chmonitor REST endpoints (create /
   read / update / delete) for each resource, with proper error surfacing (map non-2xx to
   Terraform diagnostics; a `404` on read → resource removed from state).
3. **Resources** (each = schema + CRUD + import):
   - `chmonitor_host` — backed by user-connections CRUD.
   - `chmonitor_alert_rule` — backed by alert-config/rule CRUD.
   - `chmonitor_subscription` — backed by plan/subscription resolution (Cloud-only; error
     clearly against OSS).
   - `chmonitor_user` — backed by the user/member API `(verify it supports create/delete)`.
   - `chmonitor_mcp_server` (optional) — only if roadmap-43's registry API exists.
4. **State fidelity** — implement `Read` to reflect server truth so `plan` is empty after
   `apply` (no perpetual diffs). Normalize any server-defaulted/computed fields as
   `Computed`. Support `terraform import`.
5. **Docs + examples** — generate with `terraform-plugin-docs`; ship `examples/` per resource.
6. **Publish** — GPG-sign, tag, and publish to the Terraform Registry (GoReleaser flow).

### Key files (new package)
- `terraform-provider-chmonitor/main.go`, `internal/provider/provider.go`.
- `internal/provider/resource_{host,alert_rule,subscription,user}.go` (+ `_test.go` each).
- `internal/client/` — chmonitor API client.
- `examples/`, `docs/` (generated), `go.mod`, `.goreleaser.yml`, `README.md`.
- chmonitor side: confirm the CRUD endpoints + API-key scope cover create/read/update/delete
  for each resource; no new outbound fetch is added.

### Open questions
- Which resources actually support full CRUD via API today vs. read-only? Any read-only
  resource should ship as a **data source**, not a managed resource (honest claims).
- API-key **scope/permissions** — does a `chm_` key allow mutating hosts/alert rules, and is
  it org-scoped? Confirm before implementing writes.
- `chmonitor_subscription` semantics against Polar-backed billing — is it truly mutable via
  API, or should it be a data source? `(verify)`
- Terraform acceptance tests (`TF_ACC`) need a live/mock chmonitor — decide mock vs. a
  disposable test instance.

### External setup (document; do not assume)
- Go toolchain + `terraform-plugin-framework` + `terraform-plugin-docs` + GoReleaser.
- A `chm_` API key with write scope; a chmonitor base URL (Cloud or self-host).
- Terraform Registry namespace + GPG key for signed releases.

### Monorepo boundary (critical)
- Add `terraform-provider-chmonitor/` as a package the monorepo **ignores for `bun run
  build`** (Go, separate toolchain). Ensure workspace globs / turbo (if any) don't try to
  build it. Verify root `bun run build` is unaffected.

## STOP conditions & drift check

- STOP if the chmonitor CRUD endpoints / API-key write scope for a resource can't be
  confirmed — ship that resource as a data source or defer it; do not fake writes.
- STOP if scaffolding pulls the Go package into the root `bun run build` and breaks it —
  isolate first.
- DRIFT: do not hardcode Cloud-only assumptions into provider config; `base_url` must accept
  a self-hosted instance.
- Do NOT introduce Postgres. Do NOT bypass the existing API-key auth.

## Verification

```
# monorepo must stay green (the new Go package must not join the bun build graph):
bun run build            # repo root — unaffected by terraform-provider-chmonitor
cd apps/dashboard && bun run type-check   # only if an API route/auth was touched

# the NEW package builds/tests on its own toolchain:
cd terraform-provider-chmonitor && go build ./...
cd terraform-provider-chmonitor && go test ./...        # unit; TF_ACC gated separately
cd terraform-provider-chmonitor && go vet ./...
```

## Done criteria

- `terraform-provider-chmonitor/` builds (`go build`) and tests (`go test`) on its own
  toolchain; docs generate.
- `terraform apply` creates hosts/alert-rules (and subscription/user where API-backed)
  against a chmonitor instance; `plan` is empty after apply (no refresh diffs); `destroy`
  cleans up.
- Read-only-only resources ship as data sources (honest claims).
- Provider is publishable to the Terraform Registry (signed release flow documented).
- Root `bun run build` is unaffected.

Priority: P2 · Effort: XL · Depth: E · Wave: I (Integrations) · Lever: Revenue / Enterprise
