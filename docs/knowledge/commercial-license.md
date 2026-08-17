---
id: commercial-license
title: Self-hosted commercial licenses (honor system)
type: spec
status: active
updated: 2026-08-17
tags:
  - billing
  - license
  - pricing
  - landing
related:
  - billing-checkout-flow
  - cloud-saas-mode
---

# Self-hosted commercial licenses

**Primary paid product** is a host-based license for teams that already
self-host ClickHouse. Hosted Polar SaaS stays as a convenience path only.

## Decision

- Community OSS stays GPL-3.0, unlimited, no DRM, no `CHM_LICENSE_KEY`.
- Paid SKUs live in `packages/pricing/src/licenses.ts` (not `plans.ts`).
- Yearly and lifetime on Team and Unlimited. Personal is $0.
- Buy + register: company name + website; listing on `/customers` is opt-in.
- Trust model: Polar checkout on **cloud-hooks**
  (`GET https://hooks.chmonitor.dev/checkout/license?sku=&term=`), optional
  `email`/`company`/`website` query params (customer_email + metadata).
  Polar emails the **receipt**. We do not send a license-key email.
  Register company + website after `paid=1`. Polar `success_url` **must**
  include `{CHECKOUT_ID}`. Dash URL 302s to hooks. Lookup:
  `GET /licenses/lookup?q=` (checkout id or billing email) — not a key.
  Register persist: `POST /licenses/register`. User-facing how-to:
  `docs/content/operate/advanced/commercial-license.mdx`.
  Do **not** add `CHM_LICENSE_KEY` to the OSS dashboard.

## SKUs (USD)

| id | hosts | yearly | lifetime |
|---|---|---|---|
| personal | ∞ | 0 | 0 |
| team | 3 | 499 | 1349 |
| unlimited | ∞ | 999 | 2999 |

Do not silently change these without updating landing `/pricing`, docs
`operate/advanced/commercial-license`, and README.

## Why these numbers

Self-host infra teams will not pay $29–99/mo to *us* to host a dashboard they
can run in Docker. They will pay a commercial license for invoice / support /
“we sponsor the project”. Launch ladder sits below Cloud Pro ($290/yr) and far
below pganalyze / Datadog. Three SKUs only: Personal (free self-host), Team
$499 / $1,349 (3 hosts), Unlimited $999 / $2,999.

## Surfaces

- Landing cards: `apps/landing/src/components/Pricing.astro`
- Register: `apps/landing/src/pages/license/register.astro` (paid=1 POSTs to hooks)
- Lookup: `apps/landing/src/pages/license/lookup.astro`
- Wall: `apps/landing/src/pages/customers.astro`
- User docs: `docs/content/operate/advanced/commercial-license.mdx`
- Cloud Polar checkout is hooks/landing only: [billing-checkout-flow](billing-checkout-flow.md)

## Do not

- Add license-key enforcement or fail-closed edition checks for paying.
- Add Polar checkout or plan picker back into `apps/dashboard`.
- Auto-list a company without `listPublic: true`.
