# Round 3 — Feature Roadmap (2026 H2)

> Generated 2026-07-03 at commit `c1668bb78`. Grounded in a full-repo audit (not PRD
> claims). This is the **single source of truth** for the Round-3 plan set (plans
> **14–70**). Each numbered plan below has a self-contained file `plans/NN-*.md`
> written for a zero-context executor (house convention in `plans/README.md`).
>
> Rounds 1–2 (plans 01–13) were parity + audit fixes. **Round 3 is features**:
> exhaustive, weighted to the owner's stated focus — **alerting, integrations, and
> the landing/marketing refresh** — plus the revenue and AI-advisor levers.

---

## 1. Strategy (North Star: Revenue/MRR → Adoption → AI differentiation)

**Positioning wedge — sharpened by 2026 market reality.** ClickHouse itself now ships
"Ask AI", a remote MCP server, and Claude-powered "ClickHouse Agents" (Open House 2026,
public beta) — but all three are **Cloud-locked and analytics-first**: they help data
users write queries and build visualizations on *managed* ClickHouse. None is an
**operational advisor for self-hosted clusters**. That is chmonitor's uncontested lane:

> **"pganalyze for ClickHouse"** — a ClickHouse-specific ops advisor that reads
> `system.*` and recommends **projections, skip-indexes, partition keys, PREWHERE,
> and materialized views** (DDL it *recommends, never auto-applies*), with alerting and
> integrations that work on **every** deployment (self-host, Docker, K8s, Cloud).

**Pricing is validated.** pganalyze charges **$149/mo for one server**, +$100/extra
server (replica ×0.5). chmonitor's **$29 Pro / $99 Max + $15–19 per-host overage**
undercuts it decisively while the OSS core stays free — the open-core flywheel pganalyze
never had.

**Integrations are the adoption flywheel, not the moat.** Grafana (Altinity plugin: 16.6M
downloads; official ClickHouse datasource), Datadog, and the Altinity K8s operator already
own the *raw-metrics* lane. So chmonitor's Prometheus/Grafana/OTel work must **lead with
the advisor + alerting** (things those tools don't do for ClickHouse), and meet teams where
they are (export to their stack) rather than fight to replace it.

**Three moves, in priority order:**
1. **Turn on the money** (Wave R/E). Billing infra is live (Polar + Clerk + D1; host/seat/AI
   daily/AI budget/retention all enforced). The gaps are *overage metering*, *paywall UX*,
   and *enterprise (SSO/RBAC/audit)* — the difference between "can charge" and "converts."
2. **Ship the wedge** (Wave AI). The advisor is the reason someone picks chmonitor over
   `system.query_log` + Grafana. Today the product *collects and explains*; it does not yet
   *recommend DDL*. Close that gap.
3. **Widen the mouth of the funnel** (Waves A/I/G). Alerting + integrations + an honest,
   advisor-forward landing page are what turn GitHub stars into connected clusters.

**Invariants (never violate — enforced by every plan):**
- Self-hosted/OSS stays **whole**; every plan/billing gate **fails open** without Clerk.
- AI **recommends** DDL, **never auto-applies**. Destructive actions stay ACK-gated.
- **Honest paywalls**: advertised ⟺ enforced (or explicitly `deferred`) in
  `lib/billing/plan-enforcement.ts`; landing claims must match shipped code.
- Postgres/multi-DB: **NO** for 2026 H2 (ADR carried in memory; revisit after $10k MRR).

---

## 2. Audit summary — real state vs. PRD claims

The PRD over-states "shipped." Verified reality at `c1668bb78`:

| Area | Real state (audited) |
|---|---|
| **Alerting** | Strong core: pluggable rule registry (15 builtin rules), dedup/cooldown state store, Slack/Discord/Telegram/PagerDuty/generic adapters, 5-min cron sweep, SSRF-guarded webhook proxy, insights engine. **Gaps:** no email adapter, no persisted alert history, no maintenance windows/ACK, host-level only, single global route, no escalation/on-call. |
| **Integrations** | PeerDB (read-only), Kafka UI (read-only), OTel span *viewer*, Grafana *copy-paste recipe*, outbound alert webhooks, MCP server (built-in). **Missing:** Prometheus `/metrics` exporter, inbound event bus, native Slack app, Grafana plugin, Terraform, OTel *export*, ClickHouse-Cloud connect wizard, configurable outbound webhook bus. |
| **AI advisor** | Tier-2 "collector + skill guide": 11 real tool groups, 18 skills (projection/index guidance in **prose only**), deterministic insights with static thresholds. **Missing the wedge:** no programmatic DDL recommender, no MV/projection designer, no statistical baselines, no cost estimator, no agent-eval harness. |
| **Billing** | Live and enforcing: Polar checkout/portal/webhooks, Clerk orgs, D1 cache; host/seat/AI-daily/AI-budget/retention gates all wired and fail-open. **Gaps:** AI *overage* spend never accumulated, no in-app paywall/upgrade UX, no billing dashboard card, no SSO/RBAC/audit, per-host overage unplugged. |
| **Dashboards / OSS** | Declarative query-config engine **built but dormant** (`CHM_CONFIG_SOURCE=ts` default); 40 factory / 34 hand-rolled charts; dashboards in localStorage only (D1 store exists, unwired). **The de-hardcoding lever is one flag + a pack loader away.** |
| **Landing** | Astro; hero = "See every ClickHouse query. As it runs." Query-centric, AI-agent-second. No advisor/alerting/integrations wedge, **no product analytics**, no live demo, no sample cluster, no comparison sub-pages. |

---

## 3. Master plan table (Round 3 — plans 14–70)

Priority P0–P3 · Effort S/M/L/XL · Depth **F**=full-executable, **E**=epic-brief · Wave.
Full status table lives in `plans/README.md`. Depth "F" plans are audited to file-level and
ready for an unattended overnight agent; "E" plans need light discovery first.

### Wave R — Revenue Now (monetization)
| # | Plan | P | Eff | Depth |
|---|------|---|-----|-------|
| 14 | wire-ai-overage-spend-metering | P0 | S | F |
| 15 | upgrade-paywall-modal | P0 | M | F |
| 16 | billing-usage-dashboard-card | P0 | M | F |
| 17 | checkout-webhook-e2e-tests | P1 | M | F |
| 18 | per-host-overage-billing | P1 | L | E |
| 19 | downgrade-protection | P1 | S | F |
| 20 | seat-cap-invite-time-gate | P1 | S | F |

### Wave E — Enterprise (revenue / TAM)
| # | Plan | P | Eff | Depth |
|---|------|---|-----|-------|
| 21 | sso-saml-enterprise | P2 | L | E |
| 22 | audit-log-export | P2 | M | F |
| 23 | rbac-roles-enterprise | P2 | L | E |
| 24 | enterprise-multi-org-pooling | P2 | L | E |

### Wave A — Alerting & Incident (focus)
| # | Plan | P | Eff | Depth |
|---|------|---|-----|-------|
| 25 | email-alert-adapter | P0 | M | F |
| 26 | opsgenie-adapter | P1 | M | F |
| 27 | alert-history-audit-log | P1 | M | F |
| 28 | maintenance-windows-suppression | P1 | M | F |
| 29 | alert-ack-manual-resolution | P1 | M | F |
| 30 | per-rule-alert-routing | P1 | L | E |
| 31 | compound-alert-rules | P2 | L | E |
| 32 | custom-alert-rule-builder | P2 | M | E |
| 33 | remediation-action-links | P2 | M | F |
| 34 | pagerduty-escalation-oncall | P1 | L | E |

### Wave I — Integrations & Ecosystem (focus)
| # | Plan | P | Eff | Depth |
|---|------|---|-----|-------|
| 35 | prometheus-metrics-exporter | P0 | M | F |
| 36 | inbound-event-bus-queues | P1 | L | E |
| 37 | slack-app-native-oauth | P1 | L | E |
| 38 | grafana-datasource-plugin | P1 | L | E |
| 39 | otel-trace-export | P2 | M | F |
| 40 | terraform-provider | P2 | XL | E |
| 41 | clickhouse-cloud-connect-wizard | P1 | M | F |
| 42 | kafka-consumer-control | P2 | M | F |
| 43 | mcp-custom-server-registry | P1 | M | F |
| 44 | webhook-event-bus-outbound | P1 | M | F |
| 45 | github-deploy-correlation | P2 | M | E |

### Wave AI — Advisor Differentiation (the wedge)
| # | Plan | P | Eff | Depth |
|---|------|---|-----|-------|
| 46 | query-advisor-engine | P0 | XL | E |
| 47 | mv-projection-designer | P0 | L | E |
| 48 | statistical-anomaly-baselines | P1 | M | F |
| 49 | query-cost-estimator | P1 | L | E |
| 50 | capacity-forecast-ttl-advisor | P2 | M | F |
| 51 | agent-eval-golden-tests | P1 | L | F |
| 52 | proactive-weekly-health-report | P1 | M | F |

### Wave D — Dashboards & OSS de-hardcoding
| # | Plan | P | Eff | Depth |
|---|------|---|-----|-------|
| 53 | activate-declarative-queries | P0 | S | F |
| 54 | query-config-pack-registry | P0 | M | E |
| 55 | self-hosted-local-config-override | P1 | M | F |
| 56 | dashboard-d1-persistence-sharing | P1 | M | F |
| 57 | custom-dashboard-builder-grid | P1 | L | E |
| 58 | declarative-chart-schema | P2 | M | E |
| 59 | ai-generated-dashboards | P2 | L | E |

### Wave G — Landing / Marketing / Growth (focus)
| # | Plan | P | Eff | Depth |
|---|------|---|-----|-------|
| 60 | landing-hero-wedge-refresh | P0 | L | F |
| 61 | feature-sections-advisor-alerts-refresh | P1 | M | F |
| 62 | product-analytics-funnel | P0 | M | F |
| 63 | comparison-pages-vs-competitors | P1 | M | E |
| 64 | seo-use-case-landing-pages | P2 | L | E |
| 65 | live-demo-embedded | P1 | M | E |
| 66 | onboarding-sample-cluster-preset | P1 | M | F |
| 67 | docs-blog-content-engine | P1 | M | E |
| 68 | github-star-social-proof | P2 | S | F |
| 69 | og-images-seo-meta-audit | P1 | M | F |
| 70 | landing-perf-lighthouse | P1 | S | F |

**Deferred long-tail** (captured as backlog issues, not written as plan files this round):
k8s-operator/CRD auto-discovery, dbt lineage, Aiven/Altinity cloud auto-discovery, S3 backup
audit, PeerDB safe mutations, native mobile, marketplace, visual query builder. Promote to a
numbered plan when a design-partner pulls.

---

## 4. Per-plan specs (writers expand these into `plans/NN-*.md`)

Each block is the audited spec. Writers must expand into the house format (see
`plans/README.md` + example `plans/02-plan-benefits-parity.md`): **Kickoff prompt**,
Current reality (audited), Goal, Implement-now (files/APIs), STOP conditions/drift check,
Verification commands, Done-criteria. Keep invariants. Verification baseline for every plan:
`bun run type-check` · `bun run build` · targeted `bun test … --isolate` · `bun run lint`.

### Wave R — Revenue Now

**14 · wire-ai-overage-spend-metering · P0/S/F**
- Why: overage revenue unplugged — `ai_usage_monthly` exists but per-request USD is never accumulated, so Pro/Max soft-caps bill $0 past the included allowance.
- Files: `apps/dashboard/src/routes/api/v1/agent.ts` (post-generation hook), `src/lib/billing/ai-usage-store.ts` (`addAiSpend`), `src/routes/api/v1/billing/usage.ts` (surface `aiSpentThisMonth`).
- Approach: after a successful generation, compute cost from real token usage × model price; if past the daily included allowance, `addAiSpend(owner.id, usd)`. Free hard-caps; Pro/Max meter overage; fail-open for self-host.
- Accept: overage accumulates in D1; usage API returns `aiSpentThisMonth` vs `aiMonthlyUsdBudget`; test proves Free=hardcap / Pro=meter.
- Lever: Revenue. Kickoff: "Accumulate AI overage USD via addAiSpend after each generation; Free hard-caps, Pro/Max meter, OSS untouched."

**15 · upgrade-paywall-modal · P0/M/F**
- Why: a 402 (host/seat/AI limit) returns raw JSON, not a paywall — the single biggest CVR leak.
- Files: new `src/components/billing/paywall-modal.tsx`; `src/lib/api/error-handler.ts` (classify 402 → reason); reuse `src/lib/billing/entitlements.ts:limitMessage`; wire into app error boundary/toast.
- Approach: intercept 402s, parse `reason` (host/seat/ai_daily/ai_budget), show modal with current vs next-tier caps + "Upgrade" → `POST /api/v1/billing/checkout`. Honest copy for `deferred` vs `enforced`.
- Accept: 402 shows modal not error; upgrade opens Polar checkout; dismiss clean; test per reason.
- Lever: Revenue/Adoption. Kickoff: "Add a PaywallModal that intercepts 402s and routes to Polar checkout with honest limit copy."

**16 · billing-usage-dashboard-card · P0/M/F**
- Why: no in-app surface for plan/usage/renewal — billing is invisible, so is the upgrade path.
- Files: new `src/components/billing/{current-plan-card,usage-meters,renewal-banner}.tsx`; `src/routes/(dashboard)/billing.tsx`; reuse `routes/api/v1/billing/usage.ts`.
- Approach: render plan + hosts/seats/AI-daily/AI-monthly meters (red >80%), renewal date, cancel-grace banner; CTAs → checkout / Polar portal.
- Accept: card shows all meters + renewal; over-limit state warns; buttons route correctly; tests for Free/Pro/over-limit/cancel-grace.
- Lever: Revenue/Adoption. Kickoff: "Build the in-app billing card (plan, usage meters, renewal, upgrade/manage CTAs) from /billing/usage."

**17 · checkout-webhook-e2e-tests · P1/M/F**
- Why: the checkout→webhook→D1→plan path is the revenue critical path and under-tested.
- Files: `routes/api/v1/billing/checkout.test.ts` (new), `routes/api/v1/webhooks/polar.test.ts` (extend), `src/lib/billing/__tests__/checkout-e2e.test.ts` (new), runbook `docs/knowledge/billing-checkout-flow.md`.
- Approach: unit + integration for checkout URL creation, webhook signature/idempotency/monotonic guard, D1 cache miss → Polar reconciliation; document recovery.
- Accept: checkout returns valid URL; duplicate webhooks don't double-write; reconciliation covers cache miss; runbook committed.
- Lever: Revenue. Kickoff: "Add e2e tests + runbook for checkout→Polar-webhook→D1→plan resolution incl. idempotency and reconciliation."

**18 · per-host-overage-billing · P1/L/E**
- Why: the advertised $15–19/host overage (GA pricing lever) has no code path; hosts hard-cap instead of expanding.
- Files: `packages/pricing/src/plans.ts` (add `hostOverage`), `src/lib/billing/entitlements.ts` (soft-cap paid tiers), `routes/api/v1/user-connections.ts` (allow + meter), new `host_usage_monthly` D1 table, Polar usage-based reporting.
- Approach: mirror the AI-overage model for hosts — soft-cap for paid, meter over-limit count × per-host price into monthly bill; keep Free hard-capped.
- Accept: paid tier adds 4th+ host without 402; overage metered; monthly total = base + overage; tests for Pro/Max math.
- Lever: Revenue (land-and-expand). Kickoff: "Soft-cap hosts for paid tiers and meter per-host overage into a monthly bill (mirror AI overage)."

**19 · downgrade-protection · P1/S/F**
- Why: users can downgrade below current usage and silently lose access to hosts/seats.
- Files: new `routes/api/v1/billing/can-downgrade.ts`; `src/components/billing/` (confirm modal).
- Approach: before portal link, compare current usage to target-plan limits; if over, warn with the exceeded limits and offer "stay" vs "downgrade anyway".
- Accept: over-limit downgrade warns; confirm proceeds + logs; tests Free→Pro and Max→Pro.
- Lever: Revenue (retention). Kickoff: "Add can-downgrade check + warning modal when current usage exceeds the target plan."

**20 · seat-cap-invite-time-gate · P1/S/F**
- Why: seat limit is enforced *post-hoc* via Clerk rollback — confusing UX; should pre-check at invite.
- Files: org invite endpoint (locate), `src/lib/billing/entitlements.ts:checkSeatLimit`, keep `routes/api/v1/webhooks/clerk.ts` rollback as defense-in-depth.
- Approach: pre-check `getPlanForOwner` + current member count before invite; 402 + paywall if over.
- Accept: over-cap invite returns 402 pre-add; paywall shown; webhook fallback intact; test at seats and seats+1.
- Lever: Adoption. Kickoff: "Pre-check seat limit at invite time and 402 with paywall instead of post-hoc Clerk rollback."

### Wave E — Enterprise

**21 · sso-saml-enterprise · P2/L/E**
- Why: SSO/SAML is table-stakes for enterprise deals; `edition` flags it but nothing enforces it.
- Files: new `src/lib/auth/sso/` (metadata + assertion validate), `routes/api/v1/auth/sso-callback.ts`, Clerk enterprise-connection integration, `src/lib/edition/edition.ts` (gate `sso`).
- Approach: prefer Clerk's SAML/enterprise connections; admin configures IdP + verified domain → JIT-provision org+user on assertion; map IdP groups → roles (see 23).
- Accept: SSO login provisions Clerk user+org scoped to domain; session resolves Enterprise; gated to enterprise edition.
- Lever: Enterprise/Revenue. Kickoff: "Add SAML SSO (via Clerk enterprise connections) with domain-verified JIT org provisioning, enterprise-gated."

**22 · audit-log-export · P2/M/F**
- Why: SOC2/ISO buyers need an audit trail + export; none exists.
- Files: new `audit_logs` D1 migration, `src/lib/audit/` (`logEvent`), `routes/api/v1/audit/export.ts` (CSV, date-filtered, org-scoped), wire into Clerk webhook + billing + connection mutations; enterprise-gated.
- Approach: append-only event log (ts, user, org, event, resource, action, result, ip); GET export returns org-scoped CSV.
- Accept: state-changing actions logged; CSV export filters by date + org only; tests for coverage + scoping.
- Lever: Enterprise. Kickoff: "Add an append-only audit_logs table + org-scoped CSV export, enterprise-gated, wired to member/billing/connection mutations."

**23 · rbac-roles-enterprise · P2/L/E**
- Why: `rbac.ts` is community all-access; real teams need viewer/operator/admin scoping.
- Files: `src/lib/rbac/rbac.ts` (real role→permission matrix), Clerk org roles sync, server gates on write routes (control tools, connections, alert rules), UI role management.
- Approach: define roles (viewer/operator/admin) → permissions; map Clerk org roles; enforce on write paths; fail-open to community single-operator when edition≠enterprise.
- Accept: viewer can't kill queries/edit connections; admin can; community unchanged; tests per role.
- Lever: Enterprise. Kickoff: "Implement enterprise RBAC (viewer/operator/admin) mapped from Clerk org roles, gating write routes; community stays all-access."

**24 · enterprise-multi-org-pooling · P2/L/E**
- Why: large customers run multiple Clerk orgs but want one subscription + pooled limits.
- Files: `src/lib/billing/billing-owner.ts` (parent resolution), `user-subscription.ts` (plan by parent), `org-host-count.ts` (pool), new `org_group` D1 table.
- Approach: designate a parent org; bill + pool hosts/seats/AI/retention across children; unified usage in portal.
- Accept: child orgs resolve parent plan; limits pool; one subscription; tests for pooling math.
- Lever: Enterprise/TAM. Kickoff: "Add org-group parent/child so one subscription pools hosts/seats/AI across child orgs."

### Wave A — Alerting & Incident (focus)

**25 · email-alert-adapter · P0/M/F**
- Why: email is the universal alert channel; adapters cover Slack/Discord/Telegram/PagerDuty but **not email** — an adoption blocker for teams without Slack.
- Files: new `src/lib/health/adapters/email.ts`, register in `adapters/index.ts`, `server-alert-config.ts` (`HEALTH_ALERT_EMAIL_*`), `components/health/health-settings-dialog.tsx` (recipient config + test).
- Approach: adapter renders HTML (host, check, value, thresholds, runbook link); provider via `mailgun://`/`sendgrid://`/SMTP; server reads recipients/from; test-send in settings.
- Accept: valid MIME/HTML email dispatched; provider detected from URL/env; settings test works; passes adapter test parity.
- Lever: Adoption. Kickoff: "Add an email alert adapter (Mailgun/SendGrid/SMTP) with HTML body + settings test, parity with existing adapters."

**26 · opsgenie-adapter · P1/M/F**
- Why: Opsgenie is a major on-call vendor with no adapter.
- Files: new `src/lib/health/adapters/opsgenie.ts`, register in `adapters/index.ts`, `server-alert-config.ts` (`HEALTH_ALERT_OPSGENIE_API_KEY`).
- Approach: POST Opsgenie Alert API; map severity→P1/P2, dedup key `chmonitor:{hostId}:{metric}`, tags (host/rule); detect `api.opsgenie.com`.
- Accept: well-formed alert POST; dedup matches; settings test; adapter unit test.
- Lever: Adoption/Revenue. Kickoff: "Add an Opsgenie alert adapter (Alert API, severity map, dedup key), settings test + unit test."

**27 · alert-history-audit-log · P1/M/F**
- Why: dedup state is in-memory only (lost on restart); no queryable record of dispatched alerts for audit/debugging.
- Files: new `alert_events` D1 migration, `src/lib/health/alert-history-store.ts`, `routes/api/v1/health/history.ts` (GET filtered), history card in health settings; hook `evaluateAlert` on commit.
- Approach: persist (event_time, host, rule, severity, prev_severity, decision_kind, delivered, error) after successful delivery; expose read API + UI.
- Accept: events persist post-delivery; history API filters by host/day; UI shows recent; test coverage.
- Lever: Adoption/Revenue (audit). Kickoff: "Persist dispatched alerts to a D1 alert_events log with a filtered history API + health UI card."

**28 · maintenance-windows-suppression · P1/M/F**
- Why: no way to suppress alerts during deploys/backups — a top alert-fatigue complaint.
- Files: new `maintenance_windows` D1 migration, `src/lib/health/maintenance-windows.ts`, `routes/api/v1/health/maint-windows.ts` (CRUD), `components/health/maintenance-windows-dialog.tsx`; check in `evaluateAlert`.
- Approach: window targets one/all hosts with start/end/reason; sweep suppresses (kind=`maintenance`) inside a window; record suppression in history (27).
- Accept: window suppresses matching alerts; CRUD UI; suppressed events recorded; tests for in/out of window.
- Lever: Adoption. Kickoff: "Add maintenance windows (D1 + CRUD + UI) that suppress alerts during planned work and record the suppression."

**29 · alert-ack-manual-resolution · P1/M/F**
- Why: an operator can't ACK/snooze a firing alert; it only clears when the condition clears.
- Files: new `alert_acks` D1 migration, `src/lib/health/alert-ack-store.ts`, `routes/api/v1/health/ack.ts` (POST), `components/health/active-alerts-panel.tsx`; check in `evaluateAlert`.
- Approach: ACK suppresses dispatch for a chosen duration (5/15/60/240m), records who/when; Active Alerts panel lists firing conditions + ACK controls.
- Accept: ACK suppresses for duration; persisted with actor; panel shows firing + ACK state; sweep respects ACK; tests.
- Lever: Adoption. Kickoff: "Add alert ACK/snooze (D1 + POST + Active Alerts panel) that suppresses dispatch for a chosen duration."

**30 · per-rule-alert-routing · P1/L/E**
- Why: one global webhook for all rules/hosts; teams need per-rule/per-host routing to channels.
- Files: new `alert_routes` D1 migration, `src/lib/health/alert-routing.ts`, `routes/api/v1/health/routes.ts` (CRUD), `components/health/alert-routing-dialog.tsx`; dispatch in sweep.
- Approach: route matches rule/host pattern → channel(s); sweep dispatches to all matches, records each; fallback to legacy global webhook when none match.
- Accept: rule/host routing; multi-route fan-out recorded; back-compat with global URL; tests.
- Lever: Revenue/Adoption. Kickoff: "Add per-rule/per-host alert routing (D1 + CRUD + UI) with multi-channel fan-out and legacy fallback."

**31 · compound-alert-rules · P2/L/E**
- Why: all rules are single-metric; false positives need AND/OR correlation (e.g. lag>60 AND readonly>0).
- Files: `src/lib/alerting/compound-rules.ts` (new), `rule-registry.ts` (add `depends`), sweep evaluation order.
- Approach: evaluate base rules, then compound rules over their outputs with custom predicate; own dedup/severity per compound rule; no cycles.
- Accept: compound rules combine metrics; evaluated in dependency order; example rules ship; tests.
- Lever: Adoption. Kickoff: "Add compound alert rules (AND/OR over base-rule outputs) with dependency-ordered evaluation and per-rule dedup."

**32 · custom-alert-rule-builder · P2/M/E**
- Why: users can't define rules without editing TS; blocks self-service alerting.
- Files: new `components/health/rule-builder.tsx`, `src/lib/health/rule-builder-schema.ts`, `routes/api/v1/health/custom-rules.ts` (CRUD), register dynamically at sweep start.
- Approach: "alert when [metric] [op] [threshold]" builder → safe whitelisted SQL; persist in `custom_alert_rules`; validate against injection.
- Accept: builder covers numeric-threshold rules; generated SQL safe; custom rules appear in sweep; CRUD.
- Lever: Adoption. Kickoff: "Add a safe custom-alert-rule builder (whitelisted metric/op/threshold → SQL) persisted in D1 and registered at sweep."

**33 · remediation-action-links · P2/M/F**
- Why: alerts carry no runbook/action affordance; MTTR suffers. (Advisor auto-exec stays out — invariant.)
- Files: `src/lib/health/remediation-actions.ts` (new), `rule-registry.ts` (add `remediationActions`), `adapters/slack.ts` (buttons), `routes/api/v1/health/actions.ts` (execute, auth-gated, read-only or ACK-gated).
- Approach: rules declare labeled actions (runbook link, "get diagnostics"); adapters render buttons/links; POST executes a **read-only** query or records intent; never auto-applies DDL.
- Accept: rules define actions; Slack renders buttons; action endpoint auth-gated + recorded; no destructive auto-exec.
- Lever: Adoption. Kickoff: "Add runbook/action links to alerts (Slack buttons + auth-gated read-only action endpoint); never auto-apply DDL."

**34 · pagerduty-escalation-oncall · P1/L/E**
- Why: PagerDuty adapter posts events but ignores escalation policies/on-call routing.
- Files: new `src/lib/health/pagerduty-config.ts`, `pagerduty_routing` D1 migration, extend `alert-routing.ts`, `components/health/pagerduty-setup-dialog.tsx`.
- Approach: map rule/host → PagerDuty service; PagerDuty handles escalation/on-call; one incident per (host,rule) via dedup key; API key from env.
- Accept: service selection UI; escalation honored; dedup prevents dup incidents; test-alert path.
- Lever: Revenue/Adoption. Kickoff: "Route alerts to PagerDuty services (escalation-policy aware) with per-(host,rule) dedup and setup UI."

### Wave I — Integrations & Ecosystem (focus)

**35 · prometheus-metrics-exporter · P0/M/F**
- Why: no `/metrics` endpoint — the single biggest adoption flywheel (drops chmonitor into any Prometheus/Grafana/Alertmanager stack). Grafana/Altinity own raw metrics; meet teams there.
- Files: new `routes/api/v1/metrics.ts` (or top-level `/metrics`), reuse `@chm/clickhouse-client`; gate `CHM_FEATURE_PROMETHEUS_ENABLED` (default on self-host, off in cloud).
- Approach: query `system.metrics`+`system.asynchronous_metrics` (+ chmonitor alert counters), cache ~30s, emit Prometheus text (`# HELP/# TYPE`), labeled by host.
- Accept: valid Prometheus format scrapeable at 30s; host labels; no surprise query load; test via client scrape.
- Lever: Adoption/Ecosystem. Kickoff: "Expose a cached /metrics Prometheus exporter of system.metrics + async_metrics + alert counters, feature-gated."

**36 · inbound-event-bus-queues · P1/L/E**
- Why: alerting is outbound-only; no way to ingest Alertmanager/Datadog/generic events for correlation and fan-out.
- Files: `apps/dashboard/wrangler.toml` (`[[queues.consumers]]`), new `routes/api/events/ingest.ts`, `event_log` D1, new "Inbound Events" page.
- Approach: enqueue posted events, consume async, normalize (Alertmanager/Datadog/generic), dedup by hash, retain 30d, re-emit to outbound routes; read API with filters.
- Accept: POST enqueues; consumer upserts + optional re-emit; events page lists/filter; dedup works.
- Lever: Revenue/Ecosystem. Kickoff: "Add an inbound event bus (Cloudflare Queues) that normalizes Alertmanager/Datadog/generic events, stores 30d, and can re-emit."

**37 · slack-app-native-oauth · P1/L/E**
- Why: only outbound webhooks today; a native Slack app (OAuth + slash + ACK buttons) is a headline adoption + Pro lever.
- Files: Slack manifest in `docs/slack/`, new `routes/api/v1/slack/{events,commands,interactions}.ts`, Bolt/HTTP handlers, D1 install store.
- Approach: `/chmonitor status|query|alert` slash commands (rich blocks), home tab summary, alert → channel post with "Acknowledge" button updating D1 (ties to 29).
- Accept: installs via OAuth; slash <3s; ACK button updates state; publish-ready manifest.
- Lever: Adoption/Revenue. Kickoff: "Ship a native Slack app (OAuth, slash commands, home tab, ACK buttons) bridging alerts to chmonitor state."

**38 · grafana-datasource-plugin · P1/L/E**
- Why: the Grafana recipe is copy-paste; an official plugin that ships **ClickHouse-aware alert-rule templates + advisor panels** differentiates from generic datasources.
- Files: new `apps/grafana-plugin/` (backend datasource), reuse `/api/v1/clickhouse/query`, bundle alert-rule queries; publish tarball.
- Approach: wrap chmonitor CH client as a Grafana datasource with template vars + 10 prebuilt ClickHouse alert/advisor panels; enterprise features edition-gated.
- Accept: installs via grafana-cli; queries render; alert rules import; <10-min setup; marketplace-ready.
- Lever: Adoption/Ecosystem. Kickoff: "Build an official Grafana datasource plugin with ClickHouse-specific alert/advisor panel templates."

**39 · otel-trace-export · P2/M/F**
- Why: chmonitor reads OTel spans but can't export its own query traces to a collector for correlation.
- Files: new `src/lib/otel/exporter.ts`, `@opentelemetry/exporter-trace-http`, env `CHM_OTEL_EXPORTER_URL` (opt-in).
- Approach: wrap CH query execution to emit spans (dashboard-request → clickhouse-query → system-table-read) with query_id/user/read_bytes attrs; batch export.
- Accept: spans appear in Jaeger/collector; durations match; opt-in via env; no measurable latency add.
- Lever: Adoption/Enterprise. Kickoff: "Emit + export chmonitor's own query traces as OTel spans to an external collector (opt-in)."

**40 · terraform-provider · P2/XL/E**
- Why: enterprise GitOps for cloud resources (subscriptions, hosts, alert rules, MCP servers) — sticky, high-touch.
- Files: new `terraform-provider-chmonitor/` (Go/Rust), CRUD for `chmonitor_{subscription,user,host,alert_rule}` via `chm_` API key; publish to registry.
- Approach: scaffold provider; back resources with existing D1 stores/APIs; clean plan/apply/destroy; docs + examples.
- Accept: registry publish; CRUD via TF; no refresh diffs; destroy cleans up.
- Lever: Revenue/Enterprise. Kickoff: "Ship a Terraform provider for chmonitor Cloud resources (subscriptions/hosts/alert-rules/MCP) with registry publish."

**41 · clickhouse-cloud-connect-wizard · P1/M/F**
- Why: no Cloud-vs-self-host onboarding path; ClickHouse Cloud users are a prime paying segment.
- Files: `components/connections/add-host-dialog.tsx` (Cloud preset: TLS, port 8443, host pattern hints), optional `src/lib/ch-cloud/billing-sync.ts` (usage/forecast), docs.
- Approach: detect/guide ClickHouse Cloud connections (SSL required, service hostname), validate, optional Cloud billing sync for cost-aware alerts.
- Accept: Cloud preset connects first-try; TLS defaults correct; optional billing sync populates cost card; test.
- Lever: Revenue/Adoption. Kickoff: "Add a ClickHouse Cloud connection preset (TLS/8443/hostname hints) + optional Cloud cost sync to the connect wizard."

**42 · kafka-consumer-control · P2/M/F**
- Why: Kafka UI is read-only; ops want pause/resume/offset-reset (gated).
- Files: extend `routes/(dashboard)/kafka-consumers.tsx`, new `routes/api/v1/kafka/consumers/$group.ts`, SSRF-guarded broker admin client; env `KAFKA_ADMIN_BROKER`.
- Approach: show read-only state; conditional controls only when admin broker configured; proxy through chmonitor; audit each action.
- Accept: controls appear only with admin env; pause/resume/offset work; 403 without; audited.
- Lever: Adoption/Enterprise. Kickoff: "Add gated Kafka consumer controls (pause/resume/offset) via an SSRF-guarded broker admin proxy, audited."

**43 · mcp-custom-server-registry · P1/M/F**
- Why: placeholder UI exists but users can't register external MCP servers; agentic ecosystem play.
- Files: new `routes/api/v1/mcp/{connect,servers}.ts`, extend `src/lib/ai/agent/mcp/connect-custom-servers.ts`, `mcp_server_registrations` D1, `routes/(dashboard)/agents/mcp-server-manager.tsx`.
- Approach: register (URL, auth, transport), validate/cache capabilities, load per-user alongside built-ins at conversation start; template library (Slack/GitHub/Datadog).
- Accept: register validates connectivity; custom tools usable in agent; per-user isolation; graceful degrade.
- Lever: Adoption/Ecosystem. Kickoff: "Let users register external MCP servers (D1 + validate + per-user load) usable in the agent, with a template library."

**44 · webhook-event-bus-outbound · P1/M/F**
- Why: outbound webhooks fire only for alerts; a configurable bus (fire on any event) unlocks integrations without bespoke code.
- Files: new `src/lib/events/outbound-bus.ts`, `webhook_subscriptions` D1, `routes/api/v1/webhooks/subscriptions.ts` (CRUD), emit hooks across findings/insights/alerts/connections; reuse SSRF guard.
- Approach: subscribe URL + event-type filter + secret; sign payloads (HMAC); deliver with retry/backoff; dead-letter log.
- Accept: subscribe to event types; signed delivery + retry; CRUD UI; SSRF-guarded; tests.
- Lever: Ecosystem/Adoption. Kickoff: "Add a configurable outbound webhook bus (subscribe by event type, HMAC-signed, retried, SSRF-guarded)."

**45 · github-deploy-correlation · P2/M/E**
- Why: correlating query spikes/lag with releases is high-value SRE context.
- Files: new `routes/api/v1/webhooks/github.ts`, `github_deployments` D1, timeline overlay in query-history charts.
- Approach: verify GitHub deployment webhooks; store repo/env/version/ts; render deploy markers on query-volume timeline; filter by deploy.
- Accept: signature verified; markers on timeline w/ hover; filter works; API lists recent.
- Lever: Adoption/Ecosystem. Kickoff: "Ingest GitHub deployment webhooks and overlay deploy markers on the query-volume timeline."

### Wave AI — Advisor Differentiation (the wedge)

**46 · query-advisor-engine · P0/XL/E** — *the pganalyze-for-ClickHouse wedge; highest strategic priority*
- Why: today the agent *collects + explains*; it does not *recommend DDL*. This is the reason to choose chmonitor over `query_log`+Grafana.
- Files: new `src/lib/ai/advisor/{recommendation-engine,impact-estimator,sql-rewriter}.ts`, `src/lib/ai/agent/tools/advisor-tools.ts` (`get_optimization_recommendations`), `packages/mcp-server/src/tools/advisor.ts`, `routes/(dashboard)/advisor.tsx`, tests; optionally reuse `rust/monitor-core` WASM.
- Approach: given a slow query (id or SQL) + EXPLAIN + schema, score candidate **skip-indexes** (selective predicate off PK prefix), **projections** (GROUP BY/ORDER BY mismatch), **partition keys** (range filter on non-partition col), **PREWHERE** (selective col), rank by estimated granules/bytes saved; emit ranked DDL + risk + effort; **never auto-apply**; meter as premium usage.
- Accept: recommends `ALTER … ADD INDEX/PROJECTION`/PREWHERE for >70% of analyzed slow queries; validated safe (EXPLAIN before/after, no plan breakage); billing meters; golden tests (see 51).
- Lever: **Revenue + AI-differentiation + Adoption**. Kickoff: "Build a ClickHouse DDL advisor: slow query → ranked skip-index/projection/partition/PREWHERE recommendations with impact + risk; recommend-only, metered, tested."

**47 · mv-projection-designer · P0/L/E**
- Why: extends the wedge to aggregation workloads — auto-design MV/projection DDL.
- Files: new `src/lib/ai/advisor/mv-designer.ts`, agent tool `recommend_materialized_view`, tests.
- Approach: mine top aggregation shapes from query_log (GROUP BY + aggfns); propose Summing/Aggregating MergeTree MV/projection; estimate size from `system.parts` × aggregation ratio; recommend-only.
- Accept: recommends MV for >60% high-cost aggregations; size estimate within ~10%; premium-gated; tests.
- Lever: Revenue/AI. Kickoff: "Design MV/projection DDL from frequent aggregation queries with size estimates; recommend-only, premium-gated."

**48 · statistical-anomaly-baselines · P1/M/F**
- Why: insights use static thresholds → false positives; per-cluster baselines cut them ~80%.
- Files: new `src/lib/insights/statistical-baseline.ts`, refactor `insights/collectors.ts` to `scoreAnomaly`, `anomaly_baselines` store, agent tool `explain_anomaly_score`, tests.
- Approach: fit per-host/per-metric distribution over 7d (MAD/IQR outlier reject), store (mean,σ), flag |z|>2; adapts to workload.
- Accept: false-positive rate drops materially on test workloads; fit <100ms/host; tests.
- Lever: Adoption/AI. Kickoff: "Replace static insight thresholds with per-cluster statistical baselines (z-score/MAD) + an explain tool."

**49 · query-cost-estimator · P1/L/E**
- Why: no pre-flight estimate of rows/memory/time; enables runaway-query guardrails + advisor impact math.
- Files: new `src/lib/ai/advisor/cost-estimator.ts`, extend `agent/tools/query-tools.ts` (`estimate_query_cost` runs EXPLAIN, never executes), tests.
- Approach: parse EXPLAIN INDEXES/PLAN → granules/bytes/selectivity/join build; combine with `system.columns` sizes; estimate rows/memory/time.
- Accept: rows/memory within ~2×, time within ~30% on test queries; agent can warn before running; tests.
- Lever: Adoption/AI. Kickoff: "Add a query cost estimator (EXPLAIN → rows/memory/time) used for guardrails and advisor impact scoring."

**50 · capacity-forecast-ttl-advisor · P2/M/F**
- Why: disk-full is a top incident; forecast + TTL suggestions prevent it.
- Files: new `src/lib/ai/advisor/capacity-forecaster.ts`, extend `agent/tools/storage-tools.ts` (`forecast_disk_capacity`, `suggest_ttl_adjustment`), sample `system.part_log`, tests.
- Approach: fit write-rate from part_log over 30d; forecast disk-full date; recommend TTL/partition drops that preserve required retention; recommend-only.
- Accept: forecast within ~15% on historical data; TTL suggestions never violate retention; tests.
- Lever: Adoption. Kickoff: "Forecast disk-full from part_log write rate and suggest safe TTL/partition changes (recommend-only)."

**51 · agent-eval-golden-tests · P1/L/F**
- Why: no end-to-end agent quality harness; advisor + tools need regression protection.
- Files: new `src/lib/ai/agent/__tests__/scenarios.test.ts` + `fixtures/`; mock system tables/query_log; assert tool calls + recommendations.
- Approach: 12–15 golden scenarios (slow query, disk-full, replication lag, fragmented table…); assert correct tools + safe, actionable recs; new features must extend goldens.
- Accept: all goldens pass; recommendations safe (no destructive auto-exec); CI-wired.
- Lever: Quality/AI. Kickoff: "Add a golden-scenario agent-eval suite asserting correct tool calls + safe recommendations, wired to CI."

**52 · proactive-weekly-health-report · P1/M/F**
- Why: turns insights into a recurring, shareable narrative (email/Slack) — retention + upsell surface.
- Files: new `routes/api/cron/weekly-report.ts`, `src/lib/insights/weekly-report.ts`, reuse email (25)/Slack (37) adapters, D1 report store.
- Approach: weekly cron aggregates findings + baselines (48) + capacity (50) into a narrative; deliver via configured channels; link to advisor recs.
- Accept: weekly report generated + delivered; links to findings/advisor; opt-in per host; test.
- Lever: Adoption/Revenue. Kickoff: "Generate + deliver a weekly cluster-health narrative (email/Slack) from insights, baselines, and capacity."

### Wave D — Dashboards & OSS de-hardcoding

**53 · activate-declarative-queries · P0/S/F**
- Why: the declarative query-config engine + full catalog are **built but dormant** (`CHM_CONFIG_SOURCE=ts`); flipping it live is the keystone for "less hard-coded logic."
- Files: `src/lib/query-config/index.ts` (`getConfigSource`), `declarative/catalog/*` (complete), new parity test.
- Approach: add integration test loading representative declarative configs and asserting parity with TS; document `CHM_CONFIG_SOURCE=declarative`; keep TS default (back-compat).
- Accept: declarative path routes all lookups; TS remains default; ≥10 configs match TS equivalents.
- Lever: OSS/Adoption. Kickoff: "Prove + document the dormant declarative query-config path (parity test, env docs); keep TS default."

**54 · query-config-pack-registry · P0/M/E**
- Why: lets self-hosters ship new queries without rebuilds — the real OSS-extensibility unlock.
- Files: new `src/lib/query-config/declarative/pack-registry.ts`, extend `loader.ts`, env `CHM_PACK_REGISTRY_URL`.
- Approach: pack manifest (name/version/queries/deps); fetch+validate at startup (HTTP or `file://`), cache, merge into catalog; graceful degrade on bad packs.
- Accept: Docker can load packs from URL/local mount; invalid packs rejected clearly; timeout + fallback.
- Lever: OSS/Adoption. Kickoff: "Add a query-pack registry that fetches, validates, and merges community YAML query packs into the catalog."

**55 · self-hosted-local-config-override · P1/M/F**
- Why: self-hosted teams should drop YAML queries into a mounted dir without forking.
- Files: new `src/lib/query-config/declarative/local-loader.ts`, extend `getQueryConfigByName`, Docker entrypoint (`CHM_CONFIG_DIRECTORY=/etc/chmonitor/queries.d`).
- Approach: scan mounted dir at startup, validate each YAML, merge (or `local` namespace); clear errors on invalid.
- Accept: mounted YAML appears in UI without rebuild; validation rejects bad configs; documented.
- Lever: OSS/Adoption. Kickoff: "Load user YAML query configs from a mounted /etc/chmonitor/queries.d directory at startup."

**56 · dashboard-d1-persistence-sharing · P1/M/F**
- Why: dashboards are localStorage-only; the D1 store pattern exists (conversations) but isn't wired — blocks multi-device + sharing (a paid lever).
- Files: `src/lib/dashboard-storage.ts` (add D1 backend), new `routes/api/dashboards/{list,save,delete,share}.ts`, migration.
- Approach: mirror conversation D1 store for dashboards with owner + share ACL; localStorage fallback offline; optional org defaults.
- Accept: dashboards persist across devices; optional share link; fallback works; tests.
- Lever: Revenue/Adoption. Kickoff: "Persist + share dashboards via D1 (mirror the conversation store) with localStorage fallback."

**57 · custom-dashboard-builder-grid · P1/L/E**
- Why: PRD's dynamic-dashboard vision — drag-drop widgets + time-range sync — is only partially present.
- Files: `routes/(dashboard)/dashboard.tsx`, new `components/dashboard/{grid,widget-*}.tsx` (`@dnd-kit` already a dep), shared time-range context, D1 (56).
- Approach: widget types (chart/table/stat/text), drag-drop grid layout, one shared time range, save/load via 56.
- Accept: add/move/resize widgets; single time-range drives all; layout persists.
- Lever: Adoption/Revenue. Kickoff: "Build a drag-drop dashboard grid (widget types + shared time-range) persisted via D1."

**58 · declarative-chart-schema · P2/M/E**
- Why: charts are 40 factory / 34 hand-rolled TS; a declarative schema enables community/AI-authored charts.
- Files: new `components/charts/declarative/{schema,loader,catalog}.ts` (mirror query-config declarative), migrate ~5 factory charts as templates.
- Approach: extract serializable chart fields (name/index/categories/interval), Zod schema with icon resolution, loader → ChartFactory; document authoring.
- Accept: ≥5 charts render identically from declarative defs; authoring documented.
- Lever: OSS/AI. Kickoff: "Define a declarative chart schema + loader (mirror query-config) and port 5 factory charts as templates."

**59 · ai-generated-dashboards · P2/L/E**
- Why: "show me all queries scanning >1B rows" → auto-built dashboard is a marquee AI feature.
- Files: new agent tool `suggest_dashboard`/`build_dashboard` in `agent/tools/`, chart-picker integration, reuse 57/58.
- Approach: agent maps NL + schema/query-history → chart set (from registry) → constructs dashboard via 56/57; one-click apply.
- Accept: NL request yields valid dashboard of registry charts applied without reload; tests for tool output.
- Lever: AI/Adoption. Kickoff: "Add an agent tool that turns a natural-language request into a built dashboard from the chart registry."

### Wave G — Landing / Marketing / Growth (focus — "hero + everywhere")

**60 · landing-hero-wedge-refresh · P0/L/F**
- Why: hero = "See every ClickHouse query. As it runs." — query-centric, advisor/alerting/integrations invisible; must lead with the wedge that beats Cloud-locked Ask-AI.
- Files: `apps/landing/src/components/Hero.astro`, `src/data/pricing.ts`, gallery tab order, `FinalCta.astro`.
- Approach: rewrite headline/subhead to advisor + alerts + "works on every deployment"; reorder gallery to lead with advisor/agent/alerts/topology; accent key terms; add "See a live demo" secondary CTA (ties to 65). **Honest claims only.**
- Accept: hero names advisor + alerts in first two bullets; gallery leads with advisor/alerts; no unshipped claims; A/B-ready.
- Lever: Adoption/SEO. Kickoff: "Rewrite the landing hero around the ClickHouse advisor + alerting + all-deployment wedge; reorder gallery; honest claims."

**61 · feature-sections-advisor-alerts-refresh · P1/M/F**
- Why: "update everywhere" — feature/capability/comparison sections under-sell advisor + alerting.
- Files: `components/{Features,Capabilities,Comparison}.astro`, `src/data/pricing.ts`.
- Approach: add advisor + alerting feature cards + screenshots; add "Alert rules / channels" comparison row; badge AI-backed capabilities; keep claims matched to shipped code.
- Accept: advisor + alerting appear in features + comparison; screenshots real; claims honest.
- Lever: Adoption/Revenue. Kickoff: "Refresh landing feature/capability/comparison sections to foreground the advisor + alerting, with real screenshots and honest claims."

**62 · product-analytics-funnel · P0/M/F**
- Why: **no product analytics anywhere** — flying blind on the conversion funnel that Revenue depends on.
- Files: `apps/landing/src/layouts/Base.astro`, `apps/dashboard/src/root.tsx`, CTA/pricing components; PostHog (self-hostable) or Segment; respect DNT, exclude internal IPs.
- Approach: instrument landing (pageview, CTA, pricing view, comparison) + dashboard (signup, cluster-connect, first-chart, agent message, upgrade); async, <50ms.
- Accept: ≥5 funnels tracked; 7-day retention cohort visible; no PII; negligible page-load cost.
- Lever: Revenue/Adoption. Kickoff: "Instrument landing + dashboard funnels with privacy-respecting product analytics (PostHog/Segment)."

**63 · comparison-pages-vs-competitors · P1/M/E**
- Why: high-intent "vs" search traffic; only a single on-page matrix today.
- Files: new `apps/landing/src/pages/vs-{grafana,datadog,clickhouse-cloud}.astro`, shared `components/ComparisonTable.astro`.
- Approach: per-competitor deep matrix + honest disclaimers + setup-time/TCO framing + CTA; link from main comparison; verified against shipped features.
- Accept: ≥3 vs-pages; ≥10-row tables; honest positioning; schema markup.
- Lever: SEO/Adoption. Kickoff: "Build honest /vs-grafana, /vs-datadog, /vs-clickhouse-cloud comparison pages with TCO framing and CTAs."

**64 · seo-use-case-landing-pages · P2/L/E**
- Why: long-tail organic ("ClickHouse replication monitor", "query performance analyzer").
- Files: new `apps/landing/src/pages/{monitor-queries,cluster-health,replication,performance}.astro`, shared `LandingPage.astro`.
- Approach: 4–6 keyword-targeted pages (unique hero/benefits/screens/CTA), internal-linked, sitemap submitted.
- Accept: ≥4 use-case pages; unique metadata/H1; internal links; schema markup.
- Lever: SEO/Adoption. Kickoff: "Ship 4+ SEO use-case landing pages (queries/health/replication/performance) with a shared layout."

**65 · live-demo-embedded · P1/M/E**
- Why: fastest proof-of-value; no public demo today.
- Files: new `apps/landing/src/pages/demo.astro`, demo cluster infra, read-only chmonitor user/role, hero CTA.
- Approach: public read-only ClickHouse (Hits/TPC-H) behind a rate-limited chmonitor dashboard; "See a live demo" CTA; track demo→signup.
- Accept: demo loads <3s; queries/agent/topology visible; resets periodically; conversion tracked.
- Lever: Adoption/Revenue. Kickoff: "Stand up a public read-only demo cluster + dashboard and a 'See a live demo' landing CTA with conversion tracking."

**66 · onboarding-sample-cluster-preset · P1/M/F**
- Why: "Try with sample data" removes the connect-a-cluster barrier at first run.
- Files: `components/host/first-run-empty-state.tsx`, `components/connections/add-host-dialog.tsx`, sample-cluster preset creds.
- Approach: add "Try with sample ClickHouse" that autofills a read-only demo endpoint; "connect your own" CTA after; track sample→real conversion.
- Accept: sample button on /setup; autofills + connects; convert CTA; tracked.
- Lever: Adoption/Revenue. Kickoff: "Add a 'Try with sample ClickHouse' one-click preset on first-run with a convert-to-your-own CTA."

**67 · docs-blog-content-engine · P1/M/E**
- Why: blog has one post; no SEO/nurture cadence.
- Files: `apps/blog/src/content/blog/`, `astro.config.mjs`, `apps/landing/src/components/Footer.astro`, GitHub-release→blog sync script.
- Approach: 12-week calendar (release/how-to/troubleshooting/case-study), templates, docs↔blog cross-links, RSS, landing "latest" widget.
- Accept: ≥2 posts/month cadence; posts link docs/features; RSS active; archive categories.
- Lever: SEO/Adoption. Kickoff: "Stand up a docs+blog content engine (calendar, templates, RSS, release sync, landing widget)."

**68 · github-star-social-proof · P2/S/F**
- Why: OSS social proof + discoverability; no prominent star CTA.
- Files: `apps/landing/src/components/Hero.astro`, new `components/StarCta.astro` (build-time count), mid-page card.
- Approach: star badge in hero + mid-landing card ("building in public — star us"); track clicks; live count at build.
- Accept: star CTA in hero + mid-landing; count auto-updates; clicks tracked; no layout shift.
- Lever: Adoption/OSS. Kickoff: "Add a prominent GitHub star CTA (hero badge + mid-page card, live count) with click tracking."

**69 · og-images-seo-meta-audit · P1/M/F**
- Why: social-share CTR + SERP CTR; OG images/meta not per-page.
- Files: new `apps/landing/src/scripts/generate-og.mjs` (reuse docs' takumi/resvg), `layouts/Base.astro`, per-page meta + schema (FAQPage, SoftwareApplication+Offer, BreadcrumbList).
- Approach: build-time per-page OG images; unique title/description (50–60 / 150–160); valid schema; test with validators.
- Accept: unique OG per page (<100KB, readable); unique metas; schema valid; rich-result eligible.
- Lever: SEO/Adoption. Kickoff: "Generate per-page OG images + audit titles/descriptions/schema across landing/blog for rich results."

**70 · landing-perf-lighthouse · P1/S/F**
- Why: faster landing = higher conversion + Core-Web-Vitals ranking.
- Files: `apps/landing/astro.config.mjs`, `components/{Hero,Features}.astro`; CI Lighthouse check.
- Approach: lazy-load gallery, defer hero shader until visible, code-split carousels, drop unused CSS; add CI warn <90.
- Accept: Lighthouse ≥90 mobile+desktop; LCP <2.5s; CLS <0.1; JS <250KB gz; CI gate.
- Lever: Adoption/SEO. Kickoff: "Optimize the landing to Lighthouse ≥90 / green CWV (lazy media, deferred shader, code-split) with a CI gate."

---

## 5. Findings carried from Round 2 (also get backlog issues)

Deferred but real (see `plans/README.md` §"deferred / not planned"): **SEC-04** MCP custom-server
transport unpinned · **SEC-05** raw ClickHouse errors leaked on ~20 server-defined-query routes
· **BUG-03** custom MCP clients not closed on agent 402/pre-stream throw · **DEP-01** dev/build
toolchain `bun audit` highs · **DEP-02** two markdown pipelines (measure before consolidating) ·
**DEBT-01** two chart-authoring patterns (batch the 18 mechanical) · **DOC-01** stale
"custom MCP not wired" comment. These become `finding`-labeled issues, not plan files.


