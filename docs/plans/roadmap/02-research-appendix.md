# 02 — Research Appendix (evidence base)

> Compiled 2026-07-02 from three research sweeps (competitors, ClickHouse native
> AI/MCP, pricing/WTP) + a product audit. Cited so plans can be argued against
> evidence, not vibes. Figures are point-in-time; re-verify before betting on a
> specific number.

## 1. Competitive landscape (ClickHouse monitoring)

**ClickHouse Cloud native** — Advanced Dashboard, Query Insights, Resource
Utilization, Prometheus endpoint, ClickStack (HyperDX). Architecturally
zero-added-load / idle-aware. **AI layer is the real threat:** ClickHouse Agents
(public beta Jun 2026, Claude-powered, on acquired LibreChat), Ask AI + Docs AI,
remote MCP, ClickStack agentic observability, `clickhousectl` agents. **All
Cloud-locked; analytics-first.** Our project is cited in their community docs.
- https://clickhouse.com/docs/use-cases/observability/cloud-monitoring
- https://clickhouse.com/blog/clickhouse-agents-beta
- https://clickhouse.com/blog/agentic-analytics-ask-ai-agent-and-remote-mcp-server-beta-launch

**Altinity** — Grafana dashboards (Cluster/System/Queries/Logs) + the
`vertamedia`/Altinity datasource + operator dashboard. Monitoring is *panels, not
a product*; no advisor, no AI. Support ~$100/CH-node/mo.
- https://docs.altinity.com/altinitycloud/userguide/monitoring-a-cluster/grafana-dashboards/
- https://altinity.com/clickhouse-pricing/

**Grafana + official ClickHouse plugin** — free, ubiquitous, generic BI layer;
requires Grafana+Prometheus; no CH-internals semantics. Grafana 12 added a
generic AI alert assistant.
- https://grafana.com/grafana/plugins/grafana-clickhouse-datasource/

**SigNoz / OpenObserve / ClickStack** — built *on* ClickHouse; monitor *your
apps*, not *your CH cluster*. Adjacent, not direct. Their operators are a
distribution audience (they run big CH clusters).

**pganalyze (the template to beat)** — per-server Postgres monitoring with
advisors. **$149 Production / $399 Scale (+$100/server) / Enterprise**. People pay
for **advisors** (Index/Query/Vacuum) that give *fixes, not metrics*. **No
ClickHouse equivalent exists** → our wedge.
- https://pganalyze.com/pricing

**Datadog DBM for ClickHouse (Preview)** — query-level metrics, EXPLAIN, parts &
merges observability, Cloud + self-hosted. Closest to CH-native depth anyone has
shipped; but expensive, host-priced, generic-DBM lens, and CH docs say the direct
integration isn't recommended for Cloud (idling conflict).
- https://www.datadoghq.com/blog/database-monitoring-for-clickhouse/

**AI-native DB monitoring wave (2025-26)** — pgEdge AI DBA Workbench, Azure
HorizonDB/Database Hub + SQL MCP, PostgresAI, Netdata anomaly detection. The
category is going **AI-agent + MCP**; CH-ops-specific is the only defensible part.

### Wedges to press
1. Be **pganalyze for ClickHouse** (advisor) — least-contested, highest value.
2. **Open-source-first, self-host, multi-cluster, portable.**
3. **AI agent for CH *ops/DBA*, not analytics.**
4. **MCP server** as the interoperability/ecosystem play.
5. **Instant value, zero scaffolding, transparent low price.**

### Threats
ClickHouse Cloud extending agents to ops; Datadog DBM maturing; AI-monitoring
commoditizing; ClickHouse's aggressive M&A; "good-enough" free OSS/Grafana.

## 2. ClickHouse native AI & MCP (learn + differentiate)

**Three first-party AI layers:** (a) Ask AI / Assistant + Docs AI in SQL console;
(b) **ClickHouse Agents** — managed, LibreChat-based, Claude default, no-code
Agent Builder, sandboxed code interpreter, skills/memories/artifacts, MCP tools,
SSO/RBAC; (c) internal "AgentHouse" proof (`llm.clickhouse.com`).
**Post-beta token pricing is NOT public** — do not assume a number.

**Official `mcp-clickhouse`** (Apache-2.0, Python, PyPI): tools `run_query`
(read-only by default), `list_databases`, `list_tables`, `run_chdb_select_query`.
**Two-tier write safety** (`ALLOW_WRITE_ACCESS`, then `ALLOW_DROP`). stdio (no
auth) / http+sse (bearer required). ~752★, >220k PyPI downloads (CH's Sep-2025
figure). Remote managed MCP is OAuth, Cloud-only, read-only SELECT.
- https://github.com/ClickHouse/mcp-clickhouse

**Ecosystem thesis:** "agent-facing analytics" — agents are a new DB persona
(never sleep, 10–100× query bursts). ClickStack MCP ships **semantic** tools
(find log-pattern trends, correlate outliers, inspect slow traces) that compile
to optimized SQL — **25% fewer tool calls, 2.5× more consistent, ~20% better
evals vs the generic SQL MCP** (CH internal benchmark). `clickhousectl` + Claude
agent investigates SLA breaches and scales services — **but Cloud-only**.
- https://clickhouse.com/blog/agent-facing-analytics
- https://clickhouse.com/blog/observability-mcp-server-ai-notebooks
- https://clickhouse.com/blog/monitor-and-scale-clickhouse-cloud-with-clickhousectl

**Community MCPs to steal ideas from:** Tinybird (scoped-token RLAC, "APIs as
tools", server-side `explore_data` + `text_to_sql` agent tools); Altinity
`altinity-mcp` (Go, JWE/TLS, multi-cluster access control); several read-only-safe
community servers (read-only + safety is table stakes).

### Lessons to copy (drive Plans 10 & 11)
1. **Semantic ops tools > raw SQL tools** (biggest eval win). Ship
   `check_replication_health`, `find_merge_backlog`, `explain_slow_query`,
   `diagnose_disk_pressure`, `suggest_projections` — not just `run_query`.
2. **Two-tier write safety + read-only default** (copy verbatim).
3. **Installable agent skills** (`--agent claude` pattern) — we already have
   `.agents/skills/`; package them for external agents.
4. **Scoped-token / OAuth auth**; **ground hard** (table COMMENTs, schema in
   prompt); **server-side `text_to_sql`** tuned for ClickHouse.
5. **Free audit trail** of every agent action (ops trust).

### Differentiation vs ClickHouse native AI
Works everywhere CH runs; fleet-first not service-first; deep internals ops;
proactive always-on alerting agent; BYOK/local-model/privacy; open-source +
self-hostable.

## 3. Pricing & willingness-to-pay

**AI dev-tool ladder is $20 → $60 → $200 and normalized.** Claude Pro $20 / Max
$100 (5×) / Max $200 (20×); Cursor $20/$60/$200 (each bundles a model-credit pool
≈ its price; overage at API rates); Copilot $10/$39 (moving usage-based). What
justifies $100–200: **labor-cost anchoring** (a dev-hour is $50–150; save 2–4h →
ROI), **pass-through LLM cost framing**, **headroom not features**, **identity
signaling**.
- https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- https://www.cloudzero.com/blog/cursor-ai-pricing/

**Observability/DB pricing:** pganalyze per-server $149–$399 (+$100/server);
Datadog per-host (full stack $80–120/host/mo); Grafana Cloud usage-based
(series/GB) + $8/viewer; **Sentry $29/$99 tier ladder with unlimited seats +
usage cap** (≈ our model, proven); Vercel per-seat + usage; PlanetScale pure
usage. **Per-host/server is the dominant, most-defensible infra model.**
- https://www.g2.com/products/pganalyze/pricing
- https://comparetiers.com/tools/sentry

**Usage-based AI metering:** hybrid (base + overage) is the 2026 default (>60% of
AI SaaS). Included credits + overage at **2–4× upstream cost**; **BYOK** offered
low-tier as cost-escape, removed at Team/Enterprise (Windsurf, Warp). Meter in a
legible unit (messages/runs), tokens underneath.
- https://fungies.io/ai-saas-pricing-models-2026/
- https://www.warp.dev/blog/warp-new-pricing-flexibility-byok

**Open-core / SSO tax:** enterprises reliably pay for SSO/SAML, SCIM, RBAC, audit
logs + streaming, SLA, on-prem. GitLab is the template (**Premium $29 / Ultimate
$99**, audit-streaming + compliance gated to Ultimate). SSO tax is WTP capture,
not cost (SAML ≈ $0.015/MAU).
- https://sso.tax/
- https://costbench.com/software/developer-tools/gitlab/

**Conversion benchmarks:** dev-tool freemium 1–3% (trials up to ~24%); median
SaaS trial ~8%; PQL motions ~25%; **annual discount sweet spot 15–20%, "2 months
free" beats "20% off"**; default-to-annual lifts annual share 20–30%; 3-tier
good/better/best with a highlighted recommended tier converts best.
- https://userpilot.com/blog/saas-average-conversion-rate/

### Pricing recommendations (→ Plan 01)
Keep $29/$99 anchors; add per-host overage ($15–19); AI = included investigations
+ 2–3× overage + BYOK (Free/Pro) removed at Enterprise; gate SSO/RBAC/audit at
Enterprise; annual-default "2 months free"; run the 3 experiments in Plan 01 §7.

## 4. Verified caveats / unknowns
- ClickHouse Agents post-beta token pricing — **unknown/unpublished**.
- Exact Altinity.Cloud compute rate card — not public.
- Datadog DBM-for-CH GA date/pricing — Preview (free during preview).
- `mcp-clickhouse` star/download counts — point-in-time; will have moved.
- ClickStack MCP benchmark (25%/2.5×/20%) — CH's internal numbers, not independent.
