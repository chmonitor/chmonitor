# 01 — Monetization & Pricing

> Planned at commit `ab4c34426`, 2026-07-02. Evidence: [`02-research-appendix.md`](02-research-appendix.md) §3.
> Money model chosen by owner: **Cloud SaaS subscriptions + Open-core/enterprise + Usage-based AI.**

## Goal

Turn the existing (mostly cosmetic) pricing into **enforced, converting revenue**
without breaking OSS or betraying early-access users. Concretely: a dated GA that
flips deferred gates on, a per-host expansion meter, a metered AI model, and an
Enterprise SSO/RBAC/audit bundle.

## 1. Where we are (from the audit)

- Tiers today: **Free $0 / Pro $29 / Max $99 / Enterprise custom**. Anchors are
  correct — they match proven converters (Sentry $29/$99, GitLab $29/$99).
- **Enforced today:** host cap, seat cap, retention prune, AI daily limit, AI
  monthly budget, `api_mcp_access` (Max+). Good foundation.
- **Advertised but deferred (free during early access):** alert rules, data
  export, anomaly detection, fleet view, custom dashboards, webhook integrations,
  SSO/RBAC/audit. Tracked honestly in `lib/billing/plan-enforcement.ts`.
- **Not wired:** Polar product IDs (`polarProductId` is null/undefined), metered
  overage → invoice, alert-rule CRUD, webhook delivery, SAML/SSO gates.

## 2. Pricing changes (keep anchors, reprice the *dimension*)

Do **not** move the $29/$99 anchors. Add a **per-host expansion meter** — the
most defensible infra-monitoring model (pganalyze, Datadog) and the biggest ARPA
lever for fleets.

| Tier | Price | Hosts included | Overage/host | Retention | AI investigations/mo | Alerting | AI BYOK |
|------|-------|----------------|--------------|-----------|----------------------|----------|---------|
| **Free** | $0 | 1 | — | 24–48h | 15 (or BYOK-only) | built-in rules, browser notify | yes |
| **Pro** | $29/mo | 3 | +$19/host/mo | 14 days | ~200 | rules + Slack/PagerDuty | yes |
| **Max** | $99/mo | 10 | +$15/host/mo | 30 days | ~1,000 | advanced + webhooks + fleet view | yes |
| **Enterprise** | custom (annual) | unlimited | negotiated | 100 days+ | metered/central | all + SLA | no (central billing) |

Rationale for overage rate: pganalyze charges $100/server for deep Postgres
analysis; CH monitoring should sit closer to Datadog's ~$15 infra floor. $15–$19
captures fleet expansion without scaring small users. **A 30-node self-hoster
should be paying far more than $99** — the meter is how.

**Annual:** default the pricing page to **annual with a monthly toggle**, framed
as **"2 months free"** (16.7%), which out-converts "20% off" in nearly every
test. Current 10×-monthly (≈2 months free) is already correct — just present it
annual-first.

## 3. AI agent monetization (the novel lever)

2026 hybrid default = **included credits + overage + BYOK escape valve.**

1. **Meter in "AI investigations / agent-runs," not raw tokens.** Ops users think
   in incidents, not tokens. Keep tokens as the internal cost tracker (already in
   `ai_usage_monthly`).
2. **Included per tier** (table above). Overage sold as credit packs (e.g.
   **$10 / 100 investigations**) or pay-as-you-go at **2–3× upstream LLM cost**.
3. **BYOK on Free + Pro** (user's own Anthropic/OpenAI/OpenRouter key → no credits
   consumed; our COGS $0). **Remove BYOK at Enterprise** (central billing +
   governance; matches Windsurf/Warp). The agent already supports multiple
   providers via env — expose a per-user BYOK key in Cloud, gated by tier.
4. **Wire overage → invoice.** Today spend is tracked but not billed. Connect the
   `ai_usage_monthly` accumulator to a Polar metered/usage product so overage
   generates charges. (Plan 13, task set BE-overage.)

## 4. Open-core / Enterprise bundle (the "SSO tax")

Gate the reliably-paid enterprise set at Enterprise, priced by annual contract:
**SSO/SAML + SCIM, RBAC with custom roles, audit logs + streaming, on-prem/
air-gapped license, support SLA, SOC2 artifacts, unlimited retention.** Scaffold
exists (`lib/edition`); Plan 13 wires the actual gates. The SSO tax is pure WTP
capture (real SAML cost ≈ $0.015/MAU) and enterprises reliably pay it (GitLab is
the template — its Premium/Ultimate are literally $29/$99).

## 5. Free→paid conversion levers (what to gate)

- **Retention window** (24–48h free → 14/30 days paid) — the classic converter.
- **Host count** (1 free → 3/10 + overage).
- **Alerting + integrations** (built-in/browser free → Slack/PagerDuty/webhooks paid).
- **AI headroom** (15/mo free → 200/1,000 + overage, or BYOK).
- **Fleet view + custom dashboards + data export** (Max).

Free's job is **land + PQL signal**, not feature-completeness. Dev tools convert
better than average SaaS because evaluator = user = champion; target the 8%+
self-serve band with clear paywalls at the moment of value.

## 6. GA plan (flip deferred → enforced, honestly)

1. Finish the features behind each deferred flag (alert-rule CRUD → Plan 19; data
   export → Plan 12/16; fleet view → Plan 21/11; webhooks → Plan 19; SSO/RBAC →
   Plan 13).
2. Create Polar products + populate `polarProductId` for monthly/yearly SKUs
   (incl. per-host usage product + AI overage product).
3. Announce a **dated GA**; **grandfather early-access accounts** (feature-flag
   `chm_grandfathered` on the subscription row) so they keep beta perks.
4. Flip each registry entry `deferred → enforced` behind a test asserting the
   *new* contract (the parity plan's "fail loud" discipline).

## 7. Pricing experiments (run these, don't guess)

1. **Per-host overage vs flat-tier A/B** (highest leverage) — measure ARPA +
   expansion.
2. **Annual-default "2 months free"** — measure annual-plan share (expect +20–30%).
3. **AI credit-cap sensitivity + BYOK** — generous vs tight free cap with an
   upgrade/BYOK prompt at the wall; measure free→paid + BYOK adoption. Answers
   "will people pay for AI ops?" (open question 8.2 in the strategy doc).

## Real test (for the enforcement work this plan spawns)

Each gating change lands with a test in the style of `plan-enforcement`'s parity
tests: assert that a given plan **does/does not** have a capability and that the
runtime gate **returns 402/allows** accordingly — a test that fails if the gate
regresses. No cosmetic-only pricing.

## Verification

```
bun run test:unit                       # entitlements + plan-enforcement suites
cd apps/dashboard && bun run type-check
```

## STOP conditions

- Do not enforce a gate whose feature isn't built (breaks the honesty invariant).
- Do not gate any **core monitoring** capability (self-hosted stays whole).
- Do not change OSS defaults — enforcement only activates in cloud mode.
