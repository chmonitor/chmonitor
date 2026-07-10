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

### Merged ✅ (31)

| # | Plan | PR |
|---|------|----|
| 14 | [wire-ai-overage-spend-metering.md](14-wire-ai-overage-spend-metering.md) | [#2213](https://github.com/chmonitor/chmonitor/pull/2213) |
| 17 | checkout↔webhook recovery runbook | [#2229](https://github.com/chmonitor/chmonitor/pull/2229) |
| 22 | [audit-log-export.md](22-audit-log-export.md) | [#2232](https://github.com/chmonitor/chmonitor/pull/2232) |
| 27 | [alert-history-audit-log.md](27-alert-history-audit-log.md) | [#2231](https://github.com/chmonitor/chmonitor/pull/2231) |
| 35 | [prometheus-metrics-exporter.md](35-prometheus-metrics-exporter.md) | [#2215](https://github.com/chmonitor/chmonitor/pull/2215) |
| 36 | [inbound-event-bus-queues.md](36-inbound-event-bus-queues.md) | [#2236](https://github.com/chmonitor/chmonitor/pull/2236) |
| 44 | [webhook-event-bus-outbound.md](44-webhook-event-bus-outbound.md) | [#2235](https://github.com/chmonitor/chmonitor/pull/2235) |
| 45 | [github-deploy-correlation.md](45-github-deploy-correlation.md) | [#2238](https://github.com/chmonitor/chmonitor/pull/2238) |
| 46 | [query-advisor-engine.md](46-query-advisor-engine.md) | [#2234](https://github.com/chmonitor/chmonitor/pull/2234) |
| 47 | [mv-projection-designer.md](47-mv-projection-designer.md) | [#2237](https://github.com/chmonitor/chmonitor/pull/2237) |
| 48 | [statistical-anomaly-baselines.md](48-statistical-anomaly-baselines.md) | [#2217](https://github.com/chmonitor/chmonitor/pull/2217) |
| 49 | [query-cost-estimator.md](49-query-cost-estimator.md) | [#2233](https://github.com/chmonitor/chmonitor/pull/2233) |
| 50 | [capacity-forecast-ttl-advisor.md](50-capacity-forecast-ttl-advisor.md) | [#2222](https://github.com/chmonitor/chmonitor/pull/2222) |
| 51 | [agent-eval-golden-tests.md](51-agent-eval-golden-tests.md) | [#2216](https://github.com/chmonitor/chmonitor/pull/2216) |
| 53 | [activate-declarative-queries.md](53-activate-declarative-queries.md) | [#2214](https://github.com/chmonitor/chmonitor/pull/2214) |
| 54 | [query-config-pack-registry.md](54-query-config-pack-registry.md) | [#2230](https://github.com/chmonitor/chmonitor/pull/2230) |
| 55 | [self-hosted-local-config-override.md](55-self-hosted-local-config-override.md) | [#2221](https://github.com/chmonitor/chmonitor/pull/2221) |
| 56 | [dashboard-d1-persistence-sharing.md](56-dashboard-d1-persistence-sharing.md) | [#2224](https://github.com/chmonitor/chmonitor/pull/2224) |
| 60 | [landing-hero-wedge-refresh.md](60-landing-hero-wedge-refresh.md) | [#2241](https://github.com/chmonitor/chmonitor/pull/2241) |
| 62 | [product-analytics-funnel.md](62-product-analytics-funnel.md) | [#2219](https://github.com/chmonitor/chmonitor/pull/2219) |
| 64 | [seo-use-case-landing-pages.md](64-seo-use-case-landing-pages.md) | [#2239](https://github.com/chmonitor/chmonitor/pull/2239) |
| 68 | github-star-social-proof | [#2228](https://github.com/chmonitor/chmonitor/pull/2228) |
| 69 | [og-images-seo-meta-audit.md](69-og-images-seo-meta-audit.md) | [#2223](https://github.com/chmonitor/chmonitor/pull/2223) |
| 70 | [landing-perf-lighthouse.md](70-landing-perf-lighthouse.md) | [#2226](https://github.com/chmonitor/chmonitor/pull/2226) |
| 31 | [compound-alert-rules.md](31-compound-alert-rules.md) | [#2249](https://github.com/chmonitor/chmonitor/pull/2249) |
| 52 | [proactive-weekly-health-report.md](52-proactive-weekly-health-report.md) — styled self-contained HTML narrative | [#2253](https://github.com/chmonitor/chmonitor/pull/2253) |
| 58 | [declarative-chart-schema.md](58-declarative-chart-schema.md) | [#2256](https://github.com/chmonitor/chmonitor/pull/2256) |
| 61 | [feature-sections-advisor-alerts-refresh.md](61-feature-sections-advisor-alerts-refresh.md) | [#2251](https://github.com/chmonitor/chmonitor/pull/2251) |
| 63 | [comparison-pages-vs-competitors.md](63-comparison-pages-vs-competitors.md) | [#2247](https://github.com/chmonitor/chmonitor/pull/2247) |
| 67 | [docs-blog-content-engine.md](67-docs-blog-content-engine.md) | [#2250](https://github.com/chmonitor/chmonitor/pull/2250) |

Supporting infra: [#2242](https://github.com/chmonitor/chmonitor/pull/2242) bumped
CI's `bun-version` 1.3.13→1.3.14 for the `unit-tests` coverage-writer crash
(`WriteFailed`); [#2246](https://github.com/chmonitor/chmonitor/pull/2246) then
fixed the real root cause of the related `cloudflare:workers` pre-push-hook
failures with a global `bun test` preload; [#2252](https://github.com/chmonitor/chmonitor/pull/2252)
bumped remaining stray bun pins. `unit-tests` is still a non-required check
per the babysit-PR policy above, so any residual flake there is not a blocker.

**Note:** a separate long-running autonomous swarm (see `~/.claude` memory
`chmonitor-swarm-ci-operating-context`) also works this backlog concurrently —
some merges above may originate from it rather than an interactive session.

### Held 🔶 — PR open, needs a human decision (3)

| # | Plan | PR | Why it's held |
|---|------|----|---------------|
| 25 | Email alert adapter | [#2218](https://github.com/chmonitor/chmonitor/pull/2218) | **No-op transport.** The SMTP path is a stub, and email only fires from the cron sweep when a webhook is *also* configured. Decide the real transport (Mailgun/SendGrid/SMTP) and the fire path. Owner chose to defer this decision (2026-07-03). |
| 42 | Kafka consumer control | [#2259](https://github.com/chmonitor/chmonitor/pull/2259) | **Design-level block, not just a decision.** Marked HELD by the swarm: broker-admin operations aren't implementable within the current architecture as specced — needs a redesign, not a go/no-go call. |
| 66 | Onboarding sample-cluster preset | [#2225](https://github.com/chmonitor/chmonitor/pull/2225) | **Not just a failed live-verification — a real credential-exposure risk.** The public demo (`play.clickhouse.com`) denies `query_log`/`parts`/`merges`/etc. so most pages render empty. The obvious-looking fix — point at chmonitor's own `duet-ubuntu` cloud demo host — was investigated and **rejected**: that demo's credentials are deliberately server-side-only (`CHM_CLOUD_DEMO_HOSTS`, proxied), while the onboarding preset (`sample-preset.ts`) is embedded client-side and shipped in every deployment's public JS bundle forever. Needs either a genuinely publish-safe ClickHouse demo with broad `system.*` grants, or ship with honest "limited demo" copy instead. |

### In flight — reconciling a shared-file conflict cascade (6)

Plans **26, 28, 29, 30, 32, 33** (the rest of the alerting cluster) were all
implemented in parallel against the same base commit and ALL touch the same
core dispatch function, `apps/dashboard/src/lib/health/server-sweep.ts`. Only
31 merged cleanly; the other five now cascade into `CONFLICTING` against each
other as each one lands. Reconciling them requires composing routing +
suppression gates (maintenance windows, ACKs) + rule-evaluation additions
(compound, custom) + dispatch-time formatting (Opsgenie, remediation links)
correctly, in order — not a naive per-PR rebase. **This is the current top
priority**: land them serially, verify `bun test src/lib/health/ --isolate`
passes after each (it exercises all six plans' interaction), before starting
new alerting or advisor work on top of this file. There is also a 5-way
migration-number collision (`0014_*.sql`) across plans 28/29/30/32/52 to
renumber sequentially as each lands.

| # | Plan | PR |
|---|------|----|
| 26 | [opsgenie-adapter.md](26-opsgenie-adapter.md) | [#2248](https://github.com/chmonitor/chmonitor/pull/2248) — conflicting |
| 28 | [maintenance-windows-suppression.md](28-maintenance-windows-suppression.md) | [#2254](https://github.com/chmonitor/chmonitor/pull/2254) — conflicting |
| 29 | [alert-ack-manual-resolution.md](29-alert-ack-manual-resolution.md) | [#2258](https://github.com/chmonitor/chmonitor/pull/2258) — conflicting |
| 30 | [per-rule-alert-routing.md](30-per-rule-alert-routing.md) | branch `advisor/30-per-rule-alert-routing`, PR pending reconciliation |
| 32 | [custom-alert-rule-builder.md](32-custom-alert-rule-builder.md) | [#2257](https://github.com/chmonitor/chmonitor/pull/2257) — conflicting |
| 33 | [remediation-action-links.md](33-remediation-action-links.md) | [#2255](https://github.com/chmonitor/chmonitor/pull/2255) — mergeable, will conflict once others land |

Also in flight, not yet merged: **57** [custom-dashboard-builder-grid.md](57-custom-dashboard-builder-grid.md)
([#2265](https://github.com/chmonitor/chmonitor/pull/2265), mergeable, auto-merge armed),
**41** [clickhouse-cloud-connect-wizard.md](41-clickhouse-cloud-connect-wizard.md)
([#2240](https://github.com/chmonitor/chmonitor/pull/2240), conflicting, needs a rebase),
**39** otel-trace-export (swarm-originated PR [#2243](https://github.com/chmonitor/chmonitor/pull/2243), not in the original plan file set).

### Not started ⏳ (34) — grouped by what unblocks each

Each of these needs a **product/design decision**, **depends on a held PR**, or
is **epic-scale** (new toolchain / package / enterprise auth) — i.e. not
appropriate for blind autonomous execution. Grouped by the blocker:

- **Revenue 15–16, 18–20** (5) — 🟢 **unblocked as of 2026-07-03** (plan 14 merged,
  `#2213`): [15 upgrade-paywall-modal](15-upgrade-paywall-modal.md),
  [16 billing-usage-dashboard-card](16-billing-usage-dashboard-card.md),
  [18 per-host-overage-billing](18-per-host-overage-billing.md),
  [19 downgrade-protection](19-downgrade-protection.md),
  [20 seat-cap-invite-time-gate](20-seat-cap-invite-time-gate.md).
  (17 checkout-webhook-e2e-tests already merged as a recovery-runbook doc, #2229.)
- **Enterprise 21, 23–24** (3) — edition-gated enterprise auth; prefer Clerk
  enterprise connections over a bespoke SAML stack. Product decision required:
  [21 sso-saml-enterprise](21-sso-saml-enterprise.md),
  [23 rbac-roles-enterprise](23-rbac-roles-enterprise.md),
  [24 enterprise-multi-org-pooling](24-enterprise-multi-org-pooling.md).
  (22 audit-log-export already merged, #2232.)
- **Alerting 26, 28–34** (8) — depends on held **#25** (email transport):
  [26 opsgenie-adapter](26-opsgenie-adapter.md),
  [28 maintenance-windows-suppression](28-maintenance-windows-suppression.md),
  [29 alert-ack-manual-resolution](29-alert-ack-manual-resolution.md),
  [30 per-rule-alert-routing](30-per-rule-alert-routing.md),
  [31 compound-alert-rules](31-compound-alert-rules.md),
  [32 custom-alert-rule-builder](32-custom-alert-rule-builder.md),
  [33 remediation-action-links](33-remediation-action-links.md) (ACK-gated, never auto-executes DDL),
  [34 pagerduty-escalation-oncall](34-pagerduty-escalation-oncall.md) (extends 30).
  (27 alert_events store already merged, #2231 — this cluster records into it.)
- **Integrations 37–40, 42–43** (5) — new packages/toolchains (38 Grafana
  plugin, 40 Terraform provider, 39 OTel, 37 Slack OAuth) + security-adjacent
  proxies (42/43): [37 slack-app-native-oauth](37-slack-app-native-oauth.md),
  [38 grafana-datasource-plugin](38-grafana-datasource-plugin.md),
  [39 otel-trace-export](39-otel-trace-export.md),
  [40 terraform-provider](40-terraform-provider.md),
  [42 kafka-consumer-control](42-kafka-consumer-control.md),
  [43 mcp-custom-server-registry](43-mcp-custom-server-registry.md) — 🔷 **PR open** [#2271](https://github.com/chmonitor/chmonitor/pull/2271) (per-user D1 registry, SSRF-pinned transport, template library).
  (36, 41, 44, 45, 46, 47 already merged — the plumbing/advisor foundation this cluster builds on.)
- **Advisor 52** (1) — [52 proactive-weekly-health-report](52-proactive-weekly-health-report.md)
  (depends on 25/37 delivery channels). (49 query-cost-estimator already merged, #2233.)
- **Dashboards/OSS 57–59** (3) — 🟢 **57 unblocked as of 2026-07-03** (plan 56
  merged, `#2224`): [57 custom-dashboard-builder-grid](57-custom-dashboard-builder-grid.md),
  [58 declarative-chart-schema](58-declarative-chart-schema.md),
  [59 ai-generated-dashboards](59-ai-generated-dashboards.md) (needs 57 too).
  (54 query-config pack registry already merged, #2230.)
- **Growth 61, 63, 65, 67** (4) — marketing copy must be verified against
  shipped+enforced features first; 65 depends on held **#66**:
  [61 feature-sections-advisor-alerts-refresh](61-feature-sections-advisor-alerts-refresh.md),
  [63 comparison-pages-vs-competitors](63-comparison-pages-vs-competitors.md),
  [65 live-demo-embedded](65-live-demo-embedded.md) (needs 66),
  [67 docs-blog-content-engine](67-docs-blog-content-engine.md).
  (60, 64, 68, 69, 70 already merged.)

## Round 4 — deep audit findings (71–102)

Generated by the improve skill on 2026-07-10 at commit `070f5fe0a` (8 parallel
category audits: correctness, security, perf, UI/charts/tables, content/landing,
tests, tech-debt/deps, routing/business-logic; every finding vetted against the
code before planning). Each plan is self-contained for a zero-context executor.
GitHub issue per plan (links below). Execute in numeric order unless the
Depends column says otherwise; 75 (test gate) should land before the test plans
it protects (76–78, 95).

| # | Plan | Category | Priority | Effort | Depends on | Status |
|---|------|----------|----------|--------|------------|--------|
| 71 | [cloud-demo-host-guard-coverage](71-cloud-demo-host-guard-coverage.md) | security | P1 | M | — | ⏳ TODO · [#2488](https://github.com/chmonitor/chmonitor/issues/2488) |
| 72 | [prefetch-query-key-alignment](72-prefetch-query-key-alignment.md) | bug | P1 | S | — | ⏳ TODO · [#2489](https://github.com/chmonitor/chmonitor/issues/2489) |
| 73 | [table-result-row-cap](73-table-result-row-cap.md) | perf | P1 | M | — | ⏳ TODO · [#2490](https://github.com/chmonitor/chmonitor/issues/2490) |
| 74 | [host-id-validation-unification](74-host-id-validation-unification.md) | bug | P1 | S | — | ⏳ TODO · [#2491](https://github.com/chmonitor/chmonitor/issues/2491) |
| 75 | [required-unit-tests-check](75-required-unit-tests-check.md) | dx | P1 | S | — | ⏳ TODO · [#2492](https://github.com/chmonitor/chmonitor/issues/2492) |
| 76 | [billing-resolution-tests](76-billing-resolution-tests.md) | tests | P1 | M | — | ⏳ TODO · [#2493](https://github.com/chmonitor/chmonitor/issues/2493) |
| 77 | [deploy-env-projection-tests](77-deploy-env-projection-tests.md) | tests | P1 | S | — | ⏳ TODO · [#2494](https://github.com/chmonitor/chmonitor/issues/2494) |
| 78 | [constant-time-auth-dedupe](78-constant-time-auth-dedupe.md) | security | P1 | S | — | ⏳ TODO · [#2495](https://github.com/chmonitor/chmonitor/issues/2495) |
| 79 | [menu-link-search-params](79-menu-link-search-params.md) | bug | P2 | S | — | ⏳ TODO · [#2496](https://github.com/chmonitor/chmonitor/issues/2496) |
| 80 | [background-bar-companions](80-background-bar-companions.md) | bug | P2 | S | — | ⏳ TODO · [#2497](https://github.com/chmonitor/chmonitor/issues/2497) |
| 81 | [tooltip-breakdown-fixes](81-tooltip-breakdown-fixes.md) | bug | P2 | S | — | ⏳ TODO · [#2498](https://github.com/chmonitor/chmonitor/issues/2498) |
| 82 | [data-table-utility-columns-sorting](82-data-table-utility-columns-sorting.md) | bug | P2 | S | — | ⏳ TODO · [#2499](https://github.com/chmonitor/chmonitor/issues/2499) |
| 83 | [fleet-wide-rate-limiting](83-fleet-wide-rate-limiting.md) | security | P2 | M | — | ⏳ TODO · [#2500](https://github.com/chmonitor/chmonitor/issues/2500) (closes #2467) |
| 84 | [sanitize-500-error-responses](84-sanitize-500-error-responses.md) | security | P2 | S | — | ⏳ TODO · [#2501](https://github.com/chmonitor/chmonitor/issues/2501) |
| 85 | [bug-handler-fail-closed-senders](85-bug-handler-fail-closed-senders.md) | security | P2 | S | — | ⏳ TODO · [#2502](https://github.com/chmonitor/chmonitor/issues/2502) |
| 86 | [telemetry-event-insert-bounds](86-telemetry-event-insert-bounds.md) | security | P3 | S | — | ⏳ TODO · [#2503](https://github.com/chmonitor/chmonitor/issues/2503) |
| 87 | [browser-connection-store-fixes](87-browser-connection-store-fixes.md) | bug | P2 | M | — | ⏳ TODO · [#2504](https://github.com/chmonitor/chmonitor/issues/2504) |
| 88 | [optional-table-probe-transient-errors](88-optional-table-probe-transient-errors.md) | bug | P2 | S | — | ⏳ TODO · [#2505](https://github.com/chmonitor/chmonitor/issues/2505) |
| 89 | [lazy-markdown-imports](89-lazy-markdown-imports.md) | perf | P2 | S | — | ⏳ TODO · [#2506](https://github.com/chmonitor/chmonitor/issues/2506) |
| 90 | [landing-blog-image-optimization](90-landing-blog-image-optimization.md) | perf | P2 | M | — | ⏳ TODO · [#2507](https://github.com/chmonitor/chmonitor/issues/2507) |
| 91 | [readme-docs-link-fixes](91-readme-docs-link-fixes.md) | docs | P1 | S | — | ⏳ TODO · [#2508](https://github.com/chmonitor/chmonitor/issues/2508) |
| 92 | [blog-og-duplicate-post](92-blog-og-duplicate-post.md) | docs/SEO | P2 | S | — | ⏳ TODO · [#2509](https://github.com/chmonitor/chmonitor/issues/2509) |
| 93 | [landing-copy-consistency](93-landing-copy-consistency.md) | docs | P2 | S | — | ⏳ TODO · [#2510](https://github.com/chmonitor/chmonitor/issues/2510) |
| 94 | [toolchain-version-alignment](94-toolchain-version-alignment.md) | dx | P2 | S | — | ⏳ TODO · [#2511](https://github.com/chmonitor/chmonitor/issues/2511) |
| 95 | [platform-adapter-tests](95-platform-adapter-tests.md) | tests | P2 | S | — | ⏳ TODO · [#2512](https://github.com/chmonitor/chmonitor/issues/2512) |
| 96 | [opennext-context-replacement-spike](96-opennext-context-replacement-spike.md) | migration | P3 | M | 95 | ⏳ TODO · [#2513](https://github.com/chmonitor/chmonitor/issues/2513) |
| 97 | [billing-cycle-metering-alignment](97-billing-cycle-metering-alignment.md) | business-logic | P2 | M | 76 (soft) | ✅ DONE · [#2514](https://github.com/chmonitor/chmonitor/issues/2514) |
| 98 | [cloud-mode-runtime-consistency](98-cloud-mode-runtime-consistency.md) | investigate | P3 | S–M | — | ⏳ TODO · [#2515](https://github.com/chmonitor/chmonitor/issues/2515) |
| 99 | [seat-precheck-pending-invites](99-seat-precheck-pending-invites.md) | business-logic | P3 | S | — | ⏳ TODO · [#2516](https://github.com/chmonitor/chmonitor/issues/2516) |
| 100 | [ai-usage-reservation-release](100-ai-usage-reservation-release.md) | investigate | P3 | S | — | ⏳ TODO · [#2517](https://github.com/chmonitor/chmonitor/issues/2517) |
| 101 | [chart-color-token-hygiene](101-chart-color-token-hygiene.md) | tech-debt | P3 | M | — | ⏳ TODO · [#2518](https://github.com/chmonitor/chmonitor/issues/2518) |
| 102 | [render-perf-cleanups](102-render-perf-cleanups.md) | perf | P3 | S | 72 | ⏳ TODO · [#2519](https://github.com/chmonitor/chmonitor/issues/2519) |

### Round-4 dependency notes

- 75 (make unit-tests a required check) is the verification-baseline finding —
  land early; without it every test plan protects nothing.
- 102 depends on 72 (both touch the chart/table queryKey code).
- 96 depends on 95 (adapter contract tests pin the API the spike must preserve).
- 71 and 84 both touch API route error paths — mergeable independently, but
  rebase whichever lands second.

### Round-4 findings considered and rejected

- **format-* helper consolidation** (~12 fragmented `lib/format-*` modules):
  real fragmentation, but M effort for cognitive cleanup only; existing
  implementations are individually tested. Not worth a plan now.
- **react-markdown vs streamdown consolidation**: split is defensible
  (streaming vs static); noted as an investigate-follow-up inside plan 89, not
  its own plan.
- **`query-config/index.ts` / `menu.ts` god-file concerns**: checked — cleanly
  structured declarative data, not debt.
- **axios/undici at repo root**: transitive security override pins, not
  duplicate HTTP clients.
- **Committed `.env*` values**: only intentionally-public identifiers (Sentry
  DSN, PostHog key, Polar product ids); secrets properly gitignored.
- **Concurrent org host-add overage under-count**: latent only while Polar
  overage billing is unwired; revisit inside plans/18.
- **`/v1/summary` double-WHERE 500** and **insight NaN guards**: already
  tracked as issues #2466 / #2469 — not re-planned.

## How "done" is judged (every plan)

Each plan defines:
- **Goal** — a single measurable outcome.
- **Real test** — a test that *fails today* (or would fail if the behaviour
  regressed) and passes after the change. Not a tautology.
- **Verification** — the exact commands to prove it (build + targeted test).

Testing note (CLAUDE.md): use **Bun test** for unit/logic and **Cypress** for
component/e2e. Jest has known hanging issues — do not add Jest.
