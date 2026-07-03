# Plans — cloud plan-benefits parity & follow-ups

This directory holds implementation plans for making the cloud (SaaS) **plan
benefits real, consistent, and tested**, plus the Round-2 audit fixes and the
Round-3 feature backlog.

## North-star goal

> Every benefit a plan advertises in `@chm/pricing` is (a) rendered identically
> on the landing pricing page and the in-app billing page, and (b) actually
> enforced at runtime — or explicitly, visibly marked "not yet enforced" with a
> tracking test. No advertised benefit is silently unenforced; no surface drifts
> from the canonical source.

"Fail loud" applies: if a benefit can't be enforced yet, the plan says so and a
test asserts the *current* contract so a future change can't regress it quietly.

## How this queue works

Treat this table as the **work queue**. A plan is available when its row is
`⏳ TODO` and every plan it depends on is `✅ DONE`. Dependency edges and the
per-wave kickoff prompts live in [OVERNIGHT-SWARM.md](OVERNIGHT-SWARM.md); the
strategy + per-plan specs live in [ROADMAP-2026H2.md](ROADMAP-2026H2.md).

Legend: **✅ DONE** merged to `main` · **🔶 HELD** PR open, needs a human
decision (see reason) · **⏳ TODO** not started.

## Round 1 — initial plans (01–03)

| # | Plan | Type | Risk |
|---|------|------|------|
| 01 | [allow-private-hosts.md](01-allow-private-hosts.md) | feature (self-host) | low |
| 02 | [plan-benefits-parity.md](02-plan-benefits-parity.md) | correctness + tests | medium |
| 03 | [blog-stat-strip.md](03-blog-stat-strip.md) | copy | trivial |

## Round 2 — audit fixes (04–13): all merged ✅

Security / correctness / perf fixes surfaced by the code audit. Each shipped as
its own squash-merged PR (code only; the spec files are archived here).

| # | Plan | Status | PR |
|---|------|--------|----|
| 04 | [conversation-upsert-idor.md](04-conversation-upsert-idor.md) — scope upsert to owner (cross-tenant IDOR) | ✅ DONE | [#2203](https://github.com/chmonitor/chmonitor/pull/2203) |
| 05 | [health-webhook-auth-gate.md](05-health-webhook-auth-gate.md) — write-auth on the SSRF proxy | ✅ DONE | [#2204](https://github.com/chmonitor/chmonitor/pull/2204) |
| 06 | [alert-commit-after-delivery.md](06-alert-commit-after-delivery.md) — dedup state after delivery | ✅ DONE | [#2205](https://github.com/chmonitor/chmonitor/pull/2205) |
| 07 | [parallel-connection-chart-queries.md](07-parallel-connection-chart-queries.md) — parallel chart queries | ✅ DONE | [#2206](https://github.com/chmonitor/chmonitor/pull/2206) |
| 08 | [retention-prune-characterization-tests.md](08-retention-prune-characterization-tests.md) — cron prune tests | ✅ DONE | [#2207](https://github.com/chmonitor/chmonitor/pull/2207) |
| 09 | [management-ddl-injection.md](09-management-ddl-injection.md) — escape/validate RBAC DDL | ✅ DONE | [#2208](https://github.com/chmonitor/chmonitor/pull/2208) |
| 10 | [data-table-body-render-key.md](10-data-table-body-render-key.md) — cheap render key | ✅ DONE | [#2209](https://github.com/chmonitor/chmonitor/pull/2209) |
| 11 | [clerk-webhook-handler-tests.md](11-clerk-webhook-handler-tests.md) — seat-enforcement tests | ✅ DONE | [#2210](https://github.com/chmonitor/chmonitor/pull/2210) |
| 12 | [ai-agent-doc-tool-sync.md](12-ai-agent-doc-tool-sync.md) — docs↔tools sync + anti-drift test | ✅ DONE | [#2211](https://github.com/chmonitor/chmonitor/pull/2211) |
| 13 | [ssrf-guard-ipv6-pinning-tests.md](13-ssrf-guard-ipv6-pinning-tests.md) — IPv6 + DNS-pinning tests | ✅ DONE | [#2202](https://github.com/chmonitor/chmonitor/pull/2202) |

Supporting infra PRs: [#2212](https://github.com/chmonitor/chmonitor/pull/2212)
(biome format drift) and
[#2220](https://github.com/chmonitor/chmonitor/pull/2220) (break the plan-48
baseline import cycle + clear round-3 format drift).

## Round 3 — feature backlog (14–70)

### Merged ✅ (9)

| # | Plan | PR |
|---|------|----|
| 35 | [prometheus-metrics-exporter.md](35-prometheus-metrics-exporter.md) | [#2215](https://github.com/chmonitor/chmonitor/pull/2215) |
| 48 | [statistical-anomaly-baselines.md](48-statistical-anomaly-baselines.md) | [#2217](https://github.com/chmonitor/chmonitor/pull/2217) |
| 50 | [capacity-forecast-ttl-advisor.md](50-capacity-forecast-ttl-advisor.md) | [#2222](https://github.com/chmonitor/chmonitor/pull/2222) |
| 51 | [agent-eval-golden-tests.md](51-agent-eval-golden-tests.md) | [#2216](https://github.com/chmonitor/chmonitor/pull/2216) |
| 53 | [activate-declarative-queries.md](53-activate-declarative-queries.md) | [#2214](https://github.com/chmonitor/chmonitor/pull/2214) |
| 55 | [self-hosted-local-config-override.md](55-self-hosted-local-config-override.md) | [#2221](https://github.com/chmonitor/chmonitor/pull/2221) |
| 62 | [product-analytics-funnel.md](62-product-analytics-funnel.md) | [#2219](https://github.com/chmonitor/chmonitor/pull/2219) |
| 69 | [og-images-seo-meta-audit.md](69-og-images-seo-meta-audit.md) | [#2223](https://github.com/chmonitor/chmonitor/pull/2223) |
| 70 | [landing-perf-lighthouse.md](70-landing-perf-lighthouse.md) | [#2226](https://github.com/chmonitor/chmonitor/pull/2226) |

### Held 🔶 — PR open, needs a human decision (4)

Implemented and pushed, but deliberately **not auto-merged**: each touches a
billing / security surface or failed live verification, so a person should make
the call. The spec file for each held plan lives on its PR branch (kept off
`main` until the PR merges).

| # | Plan | PR | Why it's held |
|---|------|----|---------------|
| 14 | Wire AI overage spend metering | [#2213](https://github.com/chmonitor/chmonitor/pull/2213) | **Billing surface.** As written the Free monthly-USD cap is inert — usage is bounded only by the 5-messages/day limit, so real spend is never metered against a dollar cap. Confirm the intended cap semantics before enforcing. |
| 25 | Email alert adapter | [#2218](https://github.com/chmonitor/chmonitor/pull/2218) | **No-op transport.** The SMTP path is a stub, and email only fires from the cron sweep when a webhook is *also* configured. Decide the real transport (Mailgun/SendGrid/SMTP) and the fire path. *(Branch is behind `main`; its only red is an inherited depcruise from before #2220 — update-branch clears it.)* |
| 56 | Dashboard D1 persistence & sharing | [#2224](https://github.com/chmonitor/chmonitor/pull/2224) | **Public share endpoint + entitlement surface.** Adds an unauthenticated share route and a billing/entitlement gate. Needs a security review and a CI-build proof of client/server layering. *(Only red is `codecov/patch` — soft coverage, not a merge blocker.)* |
| 66 | Onboarding sample-cluster preset | [#2225](https://github.com/chmonitor/chmonitor/pull/2225) | **Failed live verification.** The public demo endpoint (`play.clickhouse.com`) denies `query_log`/`parts`/`merges`/etc., so most monitoring pages render empty. Choose a demo endpoint that exposes the system tables before shipping the "Try with sample cluster" CTA. |

### Not started ⏳ (43) — grouped by what unblocks each

Each of these needs a **product/design decision**, **depends on a held PR**, or
is **epic-scale** (new toolchain / package / enterprise auth) — i.e. not
appropriate for blind autonomous execution. Grouped by the blocker:

- **Revenue 15–20** (6) — build on the billing enforcement in held **#14**:
  [15 upgrade-paywall-modal](15-upgrade-paywall-modal.md),
  [16 billing-usage-dashboard-card](16-billing-usage-dashboard-card.md),
  [17 checkout-webhook-e2e-tests](17-checkout-webhook-e2e-tests.md),
  [18 per-host-overage-billing](18-per-host-overage-billing.md),
  [19 downgrade-protection](19-downgrade-protection.md),
  [20 seat-cap-invite-time-gate](20-seat-cap-invite-time-gate.md). **Unblock #14 first.**
- **Enterprise 21–24** (4) — edition-gated enterprise auth; prefer Clerk
  enterprise connections over a bespoke SAML stack. Product decision required:
  [21 sso-saml-enterprise](21-sso-saml-enterprise.md),
  [22 audit-log-export](22-audit-log-export.md),
  [23 rbac-roles-enterprise](23-rbac-roles-enterprise.md),
  [24 enterprise-multi-org-pooling](24-enterprise-multi-org-pooling.md).
- **Alerting 26–34** (9) — interdependent cluster; land **#25** (held) and a
  `27` alert_events store first, then the rest record into it:
  [26 opsgenie-adapter](26-opsgenie-adapter.md),
  [27 alert-history-audit-log](27-alert-history-audit-log.md),
  [28 maintenance-windows-suppression](28-maintenance-windows-suppression.md),
  [29 alert-ack-manual-resolution](29-alert-ack-manual-resolution.md),
  [30 per-rule-alert-routing](30-per-rule-alert-routing.md),
  [31 compound-alert-rules](31-compound-alert-rules.md),
  [32 custom-alert-rule-builder](32-custom-alert-rule-builder.md),
  [33 remediation-action-links](33-remediation-action-links.md) (ACK-gated, never auto-executes DDL),
  [34 pagerduty-escalation-oncall](34-pagerduty-escalation-oncall.md) (extends 30).
- **Integrations 36–47** (11) — new packages/toolchains (38 Grafana plugin, 40
  Terraform provider, 39 OTel, 37 Slack OAuth) + security-adjacent proxies
  (42/43/44):
  [36 inbound-event-bus-queues](36-inbound-event-bus-queues.md),
  [37 slack-app-native-oauth](37-slack-app-native-oauth.md),
  [38 grafana-datasource-plugin](38-grafana-datasource-plugin.md),
  [39 otel-trace-export](39-otel-trace-export.md),
  [40 terraform-provider](40-terraform-provider.md),
  [41 clickhouse-cloud-connect-wizard](41-clickhouse-cloud-connect-wizard.md),
  [42 kafka-consumer-control](42-kafka-consumer-control.md),
  [43 mcp-custom-server-registry](43-mcp-custom-server-registry.md),
  [44 webhook-event-bus-outbound](44-webhook-event-bus-outbound.md),
  [45 github-deploy-correlation](45-github-deploy-correlation.md),
  [47 mv-projection-designer](47-mv-projection-designer.md) (recommend-only).
- **46 [query-advisor-engine](46-query-advisor-engine.md)** — 🔶 implemented,
  not yet a PR: engine + agent tool (`get_optimization_recommendations`) + MCP
  tool + `/advisor` page landed on branch `advisor/46-query-advisor-engine`
  (recommend-only, never auto-applies DDL). Held for human review before a PR
  is opened — it wires AI-usage metering (a billing surface) and the MCP
  surface has a disclosed, unmetered gap (see the branch's commit message).
- **Advisor 49, 52** (2) — [49 query-cost-estimator](49-query-cost-estimator.md)
  (builds on 46), [52 proactive-weekly-health-report](52-proactive-weekly-health-report.md)
  (depends on 25/37 delivery channels).
- **Dashboards/OSS 54, 57–59** (4) — depend on held **#56** or are epic-scope:
  [54 query-config-pack-registry](54-query-config-pack-registry.md),
  [57 custom-dashboard-builder-grid](57-custom-dashboard-builder-grid.md) (needs 56),
  [58 declarative-chart-schema](58-declarative-chart-schema.md),
  [59 ai-generated-dashboards](59-ai-generated-dashboards.md) (needs 56/57).
- **Growth 60–61, 63–65, 67–68** (7) — marketing copy must be verified against
  shipped+enforced features first (60/61/63/64), and 65 depends on held **#66**:
  [60 landing-hero-wedge-refresh](60-landing-hero-wedge-refresh.md),
  [61 feature-sections-advisor-alerts-refresh](61-feature-sections-advisor-alerts-refresh.md),
  [63 comparison-pages-vs-competitors](63-comparison-pages-vs-competitors.md),
  [64 seo-use-case-landing-pages](64-seo-use-case-landing-pages.md),
  [65 live-demo-embedded](65-live-demo-embedded.md) (needs 66),
  [67 docs-blog-content-engine](67-docs-blog-content-engine.md),
  [68 github-star-social-proof](68-github-star-social-proof.md).

## How "done" is judged (every plan)

Each plan defines:
- **Goal** — a single measurable outcome.
- **Real test** — a test that *fails today* (or would fail if the behaviour
  regressed) and passes after the change. Not a tautology.
- **Verification** — the exact commands to prove it (build + targeted test).

Testing note (CLAUDE.md): use **Bun test** for unit/logic and **Cypress** for
component/e2e. Jest has known hanging issues — do not add Jest.
