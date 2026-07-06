# 02 — Billing Model Analysis & Optimization (2026 H2)

> Companion to [`01-market-research.md`](01-market-research.md). Verdict on the current
> model, benchmarked against verified July-2026 competitor pricing, plus concrete
> optimizations and a willingness-to-pay assessment. Internal — not customer-facing.

## TL;DR

**The current model is fundamentally right — approve it, then fix the leaks.** The
$29 Pro / $99 Max anchors are well-positioned and much cheaper than the analogs
(pganalyze $149/$399, Datadog DBM ~$70/host). The problem is **not the price — it's
that the money isn't wired**: AI overage never accumulates, hosts hard-cap instead of
expanding, 402s return raw JSON instead of a paywall, and there's no in-app billing
surface. Willingness-to-pay is real but conversion is currently near-zero because the
purchase path is invisible. **Optimize collection before touching price.**

## 1. Current model (as designed)

| Lever | Current design | Status in code (per audit) |
|---|---|---|
| Free (OSS self-host) | Whole product, unlimited, fail-open | ✅ Enforced / whole |
| Pro $29/mo | Anchor tier, included hosts/seats/AI-daily | ✅ Gates wired, fail-open |
| Max $99/mo | Higher caps, more AI headroom | ✅ Gates wired |
| Per-host overage $15–19 | Expansion revenue above tier cap | ❌ **No code path — hosts hard-cap** |
| AI investigations | Included allowance + 2–3× overage + BYOK | ⚠️ Included works; **overage USD never accumulated** |
| Enterprise | SSO / RBAC / audit bundle | ❌ Flagged in `edition`, not enforced |

## 2. Benchmark — is the price right?

Verified July 2026 (sources in the research report):

| Product | Entry | Expansion | Notes |
|---|---|---|---|
| **chmonitor Pro** | **$29/mo** | +$15–19/host | OSS core free |
| **chmonitor Max** | **$99/mo** | +$15–19/host | AI headroom |
| pganalyze Production | $149/mo | +$100/server | 1 server, the analog |
| pganalyze Scale | $399/mo | +$100/server | up to 4 servers |
| Datadog DBM | ~$70/host | per-host stack | preview for ClickHouse |
| ClickHouse Cloud Basic | $66.52/mo | usage-based | Cloud-locked |
| SigNoz Teams | $49/mo | usage | wrong category |
| Grafana Cloud Pro | $19/mo | usage | visualization only |

**Reads well against three anchors:** (1) the 9-ending psychological effect (reported
5–15% lift); (2) $29 sits *above* the "$10–20/mo VPS" mental frame as an easy
individual purchase; (3) $99 lands right where self-hosters reportedly stop being
price-sensitive. We undercut the true analog (pganalyze) by ~5×.

**Willingness to pay is real but conditional:**
- Free tier is table stakes for a self-hoster dev-tool — bottom-up motion is the norm.
- Self-hosters anchor low ($10–20 VPS), so the value story must be **advice / time
  saved**, not hosting. The advisor (Wave AI) is the thing that justifies $99, not the
  dashboard.
- BYOK is a confirmed 2026 expectation (JetBrains, Copilot Jan 2026). Offer it — it
  expands the top of funnel and protects margin from token-cost volatility.

## 3. Where the model leaks (priority-ordered)

1. **AI overage never bills (P0).** `ai_usage_monthly` exists but per-request USD is
   never accumulated, so every Pro/Max user past their included allowance bills **$0**.
   This is pure lost revenue with the infra already built → Plan 14.
2. **402 returns raw JSON, not a paywall (P0).** The single biggest conversion leak: a
   user who hits a host/seat/AI limit sees an error, not an upgrade prompt → Plan 15.
3. **No in-app billing surface (P0).** No plan card, usage meters, or renewal banner —
   billing (and the upgrade path) is invisible → Plan 16.
4. **Per-host overage unplugged (P1).** The advertised $15–19/host expansion lever has
   no code path; hosts hard-cap instead of expanding → Plan 18. This is the
   land-and-expand revenue engine.
5. **No downgrade protection / seat pre-check (P1).** Retention + UX leaks → Plans 19, 20.
6. **Enterprise bundle not enforced (P2).** SSO/RBAC/audit is where $500–2k/mo deals
   live but nothing gates it → Plans 21–24.

## 4. Optimizations (concrete)

**A. Fix collection first (do before any price change).** Ship Plans 14 → 15 → 16 as a
single "turn on the money" wave. Expected effect: overage actually bills; every limit
hit becomes an upgrade opportunity; users can see and manage their plan. This is the
highest-ROI work in the entire roadmap because the infra already exists.

**B. Define an explicit included-host count per tier.** Multi-node ClickHouse is common;
at $99 + $15–19/host a 6-node cluster is a sticker-shock event. Recommendation:
- Pro $29: 1 host included, +$15/host.
- Max $99: 3 hosts included, +$15/host.
- Consider a **mid-anchor "$199 Fleet"** for 5–10 host clusters to avoid overage
  surprise and capture the multi-node segment cleanly.

**C. Lead with BYOK on the AI advisor.** Offer BYOK on Free and Pro. Included-credit
cohort on Max. Measure conversion of BYOK vs included-credit — this answers "does BYOK
cannibalize or expand?" (open question #4 in the vision doc).

**D. Replica discount (copy pganalyze).** ClickHouse replicas are common; bill a replica
as 0.5 host. Cheap goodwill, matches the analog, reduces multi-node sticker shock.

**E. Annual plans with ~2 months free.** Standard SaaS lever; improves cash + retention.
Add once monthly billing is proven end-to-end (Plan 17 e2e tests first).

**F. Honest GA flip.** Flip `deferred` → `enforced` on a dated GA, grandfather
early-access users. Keeps the "honest paywall" invariant intact while turning on revenue.

## 5. Will people pay? — assessment

**Yes, conditionally.** The segment that pays for DB monitoring exists and pays more
than we're asking (pganalyze/Datadog prove it). But three things must be true first:
1. The **advisor must produce a recommendation good enough to trust** on first run —
   this is the value that justifies $99 (open question #5). Ship read-only "suggested,
   not applied" DDL and measure accept/dismiss.
2. The **purchase path must be visible** — right now it isn't (Plans 14–16).
3. The **free tier must deliver real standalone value** so upgrade pressure is genuine,
   not a crippled-ware nudge.

**Biggest risk to WTP:** ClickHouse Cloud shipping a native advisor. Mitigation: own the
**self-hosted / Altinity / BYOC** surface they structurally won't serve, and the
**multi-cluster fleet** view Cloud abstracts away.

## 6. Recommended sequence

1. **Wave R (Plans 14–17)** — turn on collection. *Do this first; it's found money.*
2. **Included-host counts + replica discount** — kill sticker shock (extends Plan 18).
3. **BYOK on Free/Pro** — expand funnel, protect margin.
4. **Advisor depth (Wave AI)** — the thing that justifies the price.
5. **Enterprise bundle (Plans 21–24)** — only after 3–5 inbound enterprise pulls.
6. **Annual + $199 Fleet mid-anchor** — once monthly is proven.
